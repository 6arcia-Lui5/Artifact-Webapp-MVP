const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

// Deliberately memorable fixtures; this script refuses production instances.
const DEVELOPMENT_PASSWORD = process.env.DEV_ACCOUNT_PASSWORD;

async function main() {
  if (process.env.NODE_ENV !== "development" || !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) {
    throw new Error("Developer accounts can only be seeded in a Clerk development instance.");
  }
  const client = require("@clerk/express").clerkClient;
  const presets = require("../../shared/dev-accounts.json");
  const directory = path.resolve(__dirname, "../../.local");
  const credentialsPath = path.join(directory, "dev-accounts.json");
  fs.mkdirSync(directory, { recursive: true });
  const credentials = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, "utf8")) : [];
  const persist = () => fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
  const resetPasswords = process.argv.includes("--reset-passwords");

  for (const preset of presets) {
    // Keep the original primary test email for Clerk's 424242 verification flow.
    const { data } = await client.users.getUserList({ emailAddress: [preset.verificationEmail], limit: 1 });
    let user = data[0];
    let entry = credentials.find(account => account.email === preset.email || account.email === preset.verificationEmail);
    if (user && user.privateMetadata?.artifactDeveloperPreset !== preset.verificationEmail) {
      throw new Error("A preset email belongs to an unmanaged user; refusing to modify it.");
    }
    if (user && !entry && !resetPasswords) {
      throw new Error("Existing preset has no local password. Restore the credentials file or explicitly use --reset-passwords.");
    }
    if ((!user || resetPasswords || !entry) && !DEVELOPMENT_PASSWORD) {
      throw new Error("Set DEV_ACCOUNT_PASSWORD in backend/.env before creating or resetting developer accounts.");
    }
    if (!entry) {
      entry = { ...preset, password: DEVELOPMENT_PASSWORD };
      credentials.push(entry);
      persist();
    }
    if (!user) {
      user = await client.users.createUser({
        emailAddress: [preset.verificationEmail], password: DEVELOPMENT_PASSWORD,
        firstName: "Developer", lastName: preset.name.split(" ")[1],
        privateMetadata: { artifactDeveloperPreset: preset.verificationEmail },
      });
      entry.password = DEVELOPMENT_PASSWORD;
    } else if (resetPasswords) {
      await client.users.updateUser(user.id, { password: DEVELOPMENT_PASSWORD });
      entry.password = DEVELOPMENT_PASSWORD;
      persist();
    }
    if (!user.emailAddresses.some(address => address.emailAddress === preset.email)) {
      await client.emailAddresses.createEmailAddress({
        userId: user.id, emailAddress: preset.email, verified: true, primary: false,
      });
    }
    // Only the five managed development fixtures skip the new-device email check.
    // The installed SDK predates this field, so use the documented Backend API.
    const trustResponse = await fetch("https://api.clerk.com/v1/users/" + encodeURIComponent(user.id), {
      method: "PATCH",
      headers: { Authorization: "Bearer " + process.env.CLERK_SECRET_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ bypass_client_trust: true }),
    });
    if (!trustResponse.ok) throw new Error("Could not configure development account verification: HTTP " + trustResponse.status);
    const updated = await trustResponse.json();
    if (updated.bypass_client_trust !== true) throw new Error("Development verification setting was not applied.");
    await client.users.verifyPassword({ userId: user.id, password: entry.password });
    Object.assign(entry, preset, { userId: user.id });
    persist();
    console.log(preset.name + ": ready (short email and password verified)");
  }
  const rows = credentials.map(a => "| " + a.name + " | " + a.email + " | " + a.password + " |");
  fs.writeFileSync(path.join(directory, "DEV-ACCOUNTS.md"), [
    "# Local developer test accounts", "",
    "Sign in at http://localhost:5173/login. These are standard contributors in the Clerk development instance.",
    "Use dev1@example.com through dev5@example.com. All five share the password below.",
    "These five demo accounts skip the new-device email check. Existing primary test emails remain attached.", "",
    "| Account | Sign-in email | Password |", "| --- | --- | --- |", ...rows, "",
  ].join("\n"), { mode: 0o600 });
  console.log("Five accounts ready. Credentials: .local/DEV-ACCOUNTS.md (ignored by Git).");
}

main().catch(error => {
  console.error("Developer account setup failed:", error.errors?.map(item => item.message).join("; ") || error.message);
  process.exitCode = 1;
});
