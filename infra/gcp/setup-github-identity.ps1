# Creates keyless trust only. Does not grant build/deploy/data access or create billable services.
param(
  [string]$Project = 'project-970d28ee-835b-4ca2-866'
)
$ErrorActionPreference = 'Stop'
if ($Project -ne 'project-970d28ee-835b-4ca2-866') {
  throw 'This reviewed identity configuration targets the existing PlantSense project only.'
}
function Cloud([string[]]$Arguments) {
  $result = & gcloud.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments[0]) $($Arguments[1])" }
  return $result
}
$projectNumber = Cloud @('projects','describe',$Project,'--format=value(projectNumber)')
$pool = 'plantsense-github'
$provider = 'github-release'
$account = "plantsense-build-submit@$Project.iam.gserviceaccount.com"
Cloud @('services','enable','iamcredentials.googleapis.com','sts.googleapis.com','--project',$Project,'--quiet')
$pools = Cloud @('iam','workload-identity-pools','list','--location=global','--project',$Project,'--format=value(name)')
if ($pools -notcontains "projects/$projectNumber/locations/global/workloadIdentityPools/$pool") {
  Cloud @('iam','workload-identity-pools','create',$pool,'--location=global','--project',$Project,'--display-name=PlantSense GitHub release')
}
$condition = "assertion.repository_id == '1402708267' && assertion.repository_owner_id == '80165705' && assertion.ref == 'refs/heads/codex/statistics-main-integration' && assertion.workflow_ref == 'PIYUSHBONDE/stop-or-ship/.github/workflows/mumbai-release.yml@refs/heads/codex/statistics-main-integration' && assertion.event_name in ['push', 'workflow_dispatch']"
$mapping = 'google.subject=assertion.sub,attribute.repository_id=assertion.repository_id'
$providers = Cloud @('iam','workload-identity-pools','providers','list','--workload-identity-pool',$pool,'--location=global','--project',$Project,'--format=value(name)')
$resource = "projects/$projectNumber/locations/global/workloadIdentityPools/$pool/providers/$provider"
if ($providers -notcontains $resource) {
  Cloud @('iam','workload-identity-pools','providers','create-oidc',$provider,'--workload-identity-pool',$pool,'--location=global','--project',$Project,'--issuer-uri=https://token.actions.githubusercontent.com','--attribute-mapping',$mapping,'--attribute-condition',$condition)
} else {
  Cloud @('iam','workload-identity-pools','providers','update-oidc',$provider,'--workload-identity-pool',$pool,'--location=global','--project',$Project,'--issuer-uri=https://token.actions.githubusercontent.com','--attribute-mapping',$mapping,'--attribute-condition',$condition)
}
$accounts = Cloud @('iam','service-accounts','list','--project',$Project,'--format=value(email)')
if ($accounts -notcontains $account) {
  Cloud @('iam','service-accounts','create','plantsense-build-submit','--project',$Project,'--display-name=PlantSense GitHub build submitter')
}
$member = "principalSet://iam.googleapis.com/projects/$projectNumber/locations/global/workloadIdentityPools/$pool/attribute.repository_id/1402708267"
Cloud @('iam','service-accounts','add-iam-policy-binding',$account,'--project',$Project,'--role=roles/iam.workloadIdentityUser','--member',$member,'--quiet')
Write-Output "PLANTSENSE_WIF_PROVIDER=$resource"
Write-Output "PLANTSENSE_BUILD_SUBMITTER=$account"
Write-Output 'Trust configured. Build/deploy/data roles are intentionally not granted by this script.'
