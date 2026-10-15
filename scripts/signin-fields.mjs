export async function fillSignin(page, origin, username) {
  const server = new URL(origin);
  await page
    .getByLabel("Account address", { exact: true })
    .fill(`${username}@${server.host}`);
  await page
    .getByLabel("Use HTTPS", { exact: true })
    .setChecked(server.protocol === "https:");
}
