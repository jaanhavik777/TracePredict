# Hosted TracePredict

## What a workspace can do

Visit the homepage to try the browser-only sample or create a workspace. Every new workspace gets an Application service. From **Connections**, a workspace lead can add services, create connections, send a test issue, and invite team members. The invitation is a one-use link tied to the specified email address. Share the link privately with the intended recipient.

Hosted workspace accounts use the team-scoped case queue, evidence, reports, and audit log. Platform administrators are trusted operators. The original operational incidents and predictions are available to internal accounts.

## Connect GitHub Issues

1. In **Connections**, select **GitHub Issues**. Enter `owner/repository` and choose a workspace service.
2. Copy the generated webhook URL and signing secret. In the repository, open **Settings → Webhooks → Add webhook**. Use the generated URL, choose `application/json`, set the secret, and subscribe to **Issues**.
3. Open a test issue. The worker creates a case with the title and a link back to the issue. The case records the original delivery once. Issue bodies and comments stay in GitHub.

The webhook is one-way. Resolution and follow-up stay in TracePredict. The **Send test issue** button exercises TracePredict’s queue, while opening an actual issue exercises the repository’s webhook. [GitHub webhook signature documentation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

For a generic integration, choose **Signed webhook**. Use the service ID displayed with the connection credentials and follow the [signed alert specification](security-ops.md#signed-alert-intake). The destination connection is bound to its owning workspace and selected service.

## Deploy on free plans

The Blueprint provisions one **Render Free web service** and generates the app’s three secrets. Choose the region in Render. Use a **Neon Free PostgreSQL** database for storage, since Render Free PostgreSQL expires after 30 days. Neon supports the pgvector extension used by the schema. [Render Free limits](https://render.com/docs/free) · [Neon plans](https://neon.com/docs/introduction/plans) · [Neon pgvector](https://neon.com/docs/extensions/pgvector)

1. Create a Neon project on the **Free** plan. In **Connect**, turn off connection pooling and copy the direct SSL connection string for the project owner. The startup migration needs permission to create an extension and a restricted database role.
2. Push the intended release. In Render, create a **Blueprint**, connect the repository, and enter the Neon connection string as `DATABASE_URL`. The review should show one Free web service. Leave billing details unset on both accounts to avoid overage charges.
3. Open the public URL when the service is ready. The start command initializes or migrates the database before starting the app. Check `/api/health`, create a workspace, and send a test issue from **Connections**.
4. Save the generated evidence key in your secret manager. Encrypted records need this key after a restore.

The free deployment processes accepted webhook deliveries inside the web process after durably queueing them. Opening the case queue or reports triggers pending retries and overdue maintenance. Render sleeps after a period of inactivity. An incoming webhook can time out during startup, so redeliver a failed GitHub event from the repository’s Webhooks page. For other senders, configure retries with the same event ID and a fresh signature. Acknowledgement escalation and evidence expiry resume on request while using this deployment. [Render idle behavior](https://render.com/docs/free#spinning-down-on-idle) · [Redelivering GitHub webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)

To temporarily close new workspace registration, set `TRACEPREDICT_SIGNUP=disabled` on the web service. Existing members can sign in and use invitations. Email ownership verification and self-serve password recovery still require a mail delivery integration. The hosted customer workflow uses case and alert history. Semantic search and prediction training belong to the existing operational workflow.
