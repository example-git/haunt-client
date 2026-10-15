import { api, unwrap } from "./api.js";
import type { Runtime, Login } from "./types.js";
import type { InstanceClient } from "./client.js";
/** Restricted token and temporary password stay in memory, never in the vault. */
export class PasswordChangeRequired extends Error {
  private changed = false;
  constructor(
    readonly origin: string,
    readonly username: string,
    private runtime: Runtime,
    private login: Login,
    private current: string,
    private resume: (password: string) => Promise<InstanceClient>,
  ) {
    super("Choose a new password to finish signing in.");
    this.name = "PasswordChangeRequired";
  }
  async complete(password: string) {
    if (!this.changed) {
      await unwrap(
        api(this.origin, this.runtime, this.login.token).PUT(
          "/api/v1/me/password",
          {
            body: { current_password: this.current, new_password: password },
          },
        ),
      );
      this.changed = true;
      this.current = "";
    }
    return this.resume(password);
  }
  async cancel() {
    this.current = "";
    await api(this.origin, this.runtime, this.login.token)
      .POST("/api/v1/auth/logout")
      .catch(() => {});
  }
}
