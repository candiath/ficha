// DEPLOY_NO_BLUE_GREEN=always, set in ops/.env and passed to the production
// API by compose.yaml: ops/deploy.sh stops the old API before starting the new
// one (ops/README.md, *Without blue/green*). deploy.sh accepts only "always";
// the API treats any other non-empty value as set too, so a typo that
// deploy.sh rejects still raises the alert instead of hiding it.
export function blueGreenDisabled(env: NodeJS.ProcessEnv): boolean {
  return (env.DEPLOY_NO_BLUE_GREEN ?? '').trim() !== '';
}
