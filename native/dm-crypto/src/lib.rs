//! Thin persistence/serialization boundary around OpenMLS. No custom key exchange.
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::OpenMlsRustCrypto;
use openmls_traits::{OpenMlsProvider, signatures::Signer};
use serde_json::{json, Value};
use tls_codec::{Deserialize as TLSDeserialize, Serialize as TLSSerialize};
use wasm_bindgen::prelude::*;

const SUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
type Failure = Box<dyn std::error::Error>;
#[derive(serde::Serialize, serde::Deserialize)]
struct Saved {
    identity: String,
    signer: SignatureKeyPair,
    storage: Vec<(Vec<u8>,Vec<u8>)>,
}
#[derive(serde::Deserialize)]
struct Input {
    op: String,
    #[serde(default)] identity: String,
    #[serde(default)] state: Option<Saved>,
    #[serde(default)] group: String,
    #[serde(default)] bytes: Vec<u8>,
    #[serde(default)] packages: Vec<Vec<u8>>,
    #[serde(default)] remove: Vec<u32>,
    #[serde(default)] count: usize,
}
fn members(group: &MlsGroup)->Value {
 json!(group.members().map(|m|json!({"index":m.index.u32(),"credential":m.credential.serialized_content(),"key":m.signature_key})).collect::<Vec<_>>())
}
fn run(input: &str)->Result<String,Failure> {
 if input.len()>32*1024*1024{return Err("crypto input too large".into())}
 let req:Input=serde_json::from_str(input)?;
 let mut saved=match req.state {Some(s)=>s,None=>{
  if req.op!="identity" || req.identity.is_empty() || req.identity.len()>512 {return Err("identity required".into())}
  Saved{identity:req.identity,signer:SignatureKeyPair::new(SUITE.signature_algorithm())?,storage:vec![]}
 }};
 let provider=OpenMlsRustCrypto::default();
 {let mut kv=provider.storage().values.write().map_err(|_|"storage unavailable")?;kv.extend(saved.storage.drain(..));}
 saved.signer.store(provider.storage())?;
 let credential=CredentialWithKey{credential:BasicCredential::new(saved.identity.as_bytes().to_vec()).into(),signature_key:saved.signer.public().into()};
 let mut result=json!({"key":saved.signer.public()});
 match req.op.as_str() {
  "identity"=>{},
  "sign"=>{result["signature"]=json!(saved.signer.sign(&req.bytes).map_err(|_|"signing failed")?);},
  "packages"=>{
   if req.count>32{return Err("too many packages".into())}
   let mut packages=vec![];
   for _ in 0..req.count {let kp=KeyPackage::builder().build(SUITE,&provider,&saved.signer,credential.clone())?;packages.push(kp.key_package().tls_serialize_detached()?);}
   result["packages"]=json!(packages);
  },
  "create"=>{
   if MlsGroup::load(provider.storage(),&GroupId::from_slice(req.group.as_bytes()))?.is_some(){return Err("group exists".into())}
   let config=MlsGroupCreateConfig::builder().ciphersuite(SUITE).use_ratchet_tree_extension(true).wire_format_policy(PURE_PLAINTEXT_WIRE_FORMAT_POLICY).max_past_epochs(1024).build();
   let mut group=MlsGroup::new_with_group_id(&provider,&saved.signer,&config,GroupId::from_slice(req.group.as_bytes()),credential)?;
   let packages=req.packages.iter().map(|v|KeyPackageIn::tls_deserialize_exact(v)?.validate(provider.crypto(),ProtocolVersion::Mls10).map_err(|e|Box::<dyn std::error::Error>::from(e))).collect::<Result<Vec<_>,Failure>>()?;
   if packages.is_empty(){return Err("recipient devices required".into())}
   let (commit,welcome,_)=group.add_members(&provider,&saved.signer,&packages)?;
   group.merge_pending_commit(&provider)?;
   result["commit"]=json!(commit.tls_serialize_detached()?);result["welcome"]=json!(welcome.tls_serialize_detached()?);result["members"]=members(&group);result["epoch"]=json!(group.epoch().as_u64());
  },
  "join"=>{
   if MlsGroup::load(provider.storage(),&GroupId::from_slice(req.group.as_bytes()))?.is_some(){return Err("group exists".into())}
   let welcome=match MlsMessageIn::tls_deserialize_exact(&req.bytes)?.extract(){MlsMessageBodyIn::Welcome(w)=>w,_=>return Err("welcome required".into())};
   let config=MlsGroupJoinConfig::builder().use_ratchet_tree_extension(true).wire_format_policy(PURE_PLAINTEXT_WIRE_FORMAT_POLICY).max_past_epochs(1024).build();
   let group=StagedWelcome::new_from_welcome(&provider,&config,welcome,None)?.into_group(&provider)?;
   if group.group_id().as_slice()!=req.group.as_bytes(){return Err("wrong group".into())}
   result["members"]=members(&group);result["epoch"]=json!(group.epoch().as_u64());
  },
  "send"|"receive"|"members"|"update"=>{
   let mut group=MlsGroup::load(provider.storage(),&GroupId::from_slice(req.group.as_bytes()))?.ok_or("group unavailable")?;
   match req.op.as_str(){
    "send"=>{let out=group.create_message(&provider,&saved.signer,&req.bytes)?;result["message"]=json!(out.tls_serialize_detached()?);},
    "receive"=>{
     let msg=MlsMessageIn::tls_deserialize_exact(&req.bytes)?.try_into_protocol_message()?;
     let processed=group.process_message(&provider,msg)?;
     result["sender"]=json!(processed.credential().serialized_content());
     match processed.into_content(){
      ProcessedMessageContent::ApplicationMessage(m)=>{result["plaintext"]=json!(m.into_bytes());},
      ProcessedMessageContent::StagedCommitMessage(c)=>{group.merge_staged_commit(&provider,*c)?;result["committed"]=json!(true);},
      _=>return Err("standalone proposals are not accepted".into()),
     }
    },
    "update"=>{
     // One commit type at a time simplifies roster checks and retry semantics.
     let (commit,welcome)=if !req.remove.is_empty(){
      if !req.packages.is_empty(){return Err("mixed membership changes".into())}
      let indices=req.remove.into_iter().map(LeafNodeIndex::new).collect::<Vec<_>>();let (c,w,_)=group.remove_members(&provider,&saved.signer,&indices)?;(c,w)
     }else{
      let packages=req.packages.iter().map(|v|KeyPackageIn::tls_deserialize_exact(v)?.validate(provider.crypto(),ProtocolVersion::Mls10).map_err(|e|Box::<dyn std::error::Error>::from(e))).collect::<Result<Vec<_>,Failure>>()?;
      let(c,w,_)=group.add_members(&provider,&saved.signer,&packages)?;(c,Some(w))
     };
     group.merge_pending_commit(&provider)?;
     result["commit"]=json!(commit.tls_serialize_detached()?);if let Some(w)=welcome{result["welcome"]=json!(w.tls_serialize_detached()?)}
    },_=>{},
   }
   result["members"]=members(&group);result["epoch"]=json!(group.epoch().as_u64());
  },_=>return Err("unknown crypto operation".into()),
 }
 saved.storage=provider.storage().values.read().map_err(|_|"storage unavailable")?.iter().map(|(k,v)|(k.clone(),v.clone())).collect();
 result["state"]=serde_json::to_value(saved)?;
 Ok(serde_json::to_string(&result)?)
}
#[wasm_bindgen]
pub fn operation(input:&str)->Result<String,JsError>{run(input).map_err(|e|JsError::new(&e.to_string()))}

#[cfg(test)]
mod tests {
 use super::*;
 fn call(value:Value)->Value{serde_json::from_str(&run(&value.to_string()).unwrap()).unwrap()}
 #[test]
 fn persisted_roundtrip_tamper_replay_and_wrong_group(){
  let a=call(json!({"op":"identity","identity":"alice"}));
  let b=call(json!({"op":"identity","identity":"bob"}));
  let b=call(json!({"op":"packages","state":b["state"],"count":1}));
  let a=call(json!({"op":"create","state":a["state"],"group":"private","packages":b["packages"]}));
  let b=call(json!({"op":"join","state":b["state"],"group":"private","bytes":a["welcome"]}));
  let sent=call(json!({"op":"send","state":a["state"],"group":"private","bytes":b"private text".to_vec()}));
  let mut bytes:Vec<u8>=serde_json::from_value(sent["message"].clone()).unwrap();let len=bytes.len();bytes[len-1]^=1;
  assert!(run(&json!({"op":"receive","state":b["state"],"group":"private","bytes":bytes}).to_string()).is_err());
  assert!(run(&json!({"op":"receive","state":b["state"],"group":"other","bytes":sent["message"]}).to_string()).is_err());
  let received=call(json!({"op":"receive","state":b["state"],"group":"private","bytes":sent["message"]}));
  assert_eq!(received["plaintext"],json!(b"private text".to_vec()));
  assert!(run(&json!({"op":"receive","state":received["state"],"group":"private","bytes":sent["message"]}).to_string()).is_err());
  let c=call(json!({"op":"identity","identity":"carol"}));
  let c=call(json!({"op":"packages","state":c["state"],"count":1}));
  // A participant who JOINED the group must also be able to invite devices.
  // Every call reloads persisted state, matching the browser worker boundary.
  let b=call(json!({"op":"update","state":received["state"],"group":"private","packages":c["packages"]}));
  let a=call(json!({"op":"receive","state":sent["state"],"group":"private","bytes":b["commit"]}));
  let c=call(json!({"op":"join","state":c["state"],"group":"private","bytes":b["welcome"]}));
  let sent=call(json!({"op":"send","state":a["state"],"group":"private","bytes":b"new epoch".to_vec()}));
  let received=call(json!({"op":"receive","state":c["state"],"group":"private","bytes":sent["message"]}));
  assert_eq!(received["plaintext"],json!(b"new epoch".to_vec()));
 }
}
