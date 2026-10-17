# Build resources only. Does not grant deployment, operational database, secrets or AI access.
$ErrorActionPreference = 'Stop'
$project = 'project-970d28ee-835b-4ca2-866'
$region = 'asia-south1'
$submitter = "plantsense-build-submit@$project.iam.gserviceaccount.com"
$executor = "plantsense-build-exec@$project.iam.gserviceaccount.com"
$bucket = "$project-plantsense-build-source"
function Cloud([string[]]$Arguments) {
  $result = & gcloud.cmd @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments[0]) $($Arguments[1])" }
  return $result
}
$accounts = Cloud @('iam','service-accounts','list','--project',$project,'--format=value(email)')
if ($accounts -notcontains $submitter) { throw 'Run setup-github-identity.ps1 first.' }
if ($accounts -notcontains $executor) {
  Cloud @('iam','service-accounts','create','plantsense-build-exec','--project',$project,'--display-name=PlantSense isolated image builder')
}
$repositories = Cloud @('artifacts','repositories','list','--location',$region,'--project',$project,'--format=value(name)')
if (-not ($repositories | Where-Object { $_ -match '/repositories/plantsense$' })) {
  Cloud @('artifacts','repositories','create','plantsense','--location',$region,'--project',$project,'--repository-format=docker','--description=PlantSense Mumbai release images')
}
$buckets = Cloud @('storage','buckets','list','--project',$project,'--format=value(name)')
if (($buckets -notcontains $bucket) -and ($buckets -notcontains "gs://$bucket/")) {
  Cloud @('storage','buckets','create',"gs://$bucket",'--project',$project,'--location',$region,'--uniform-bucket-level-access','--public-access-prevention')
}
$lifecyclePath = Join-Path $PSScriptRoot 'build-source-lifecycle.json'
Cloud @('storage','buckets','update',"gs://$bucket",'--project',$project,'--lifecycle-file',$lifecyclePath,'--clear-soft-delete')
foreach ($role in @('roles/cloudbuild.builds.editor','roles/serviceusage.serviceUsageConsumer')) {
  Cloud @('projects','add-iam-policy-binding',$project,'--member',"serviceAccount:$submitter",'--role',$role,'--condition=None','--quiet') | Out-Null
}
Cloud @('iam','service-accounts','add-iam-policy-binding',$executor,'--project',$project,'--member',"serviceAccount:$submitter",'--role=roles/iam.serviceAccountUser','--quiet') | Out-Null
Cloud @('projects','add-iam-policy-binding',$project,'--member',"serviceAccount:$executor",'--role=roles/logging.logWriter','--condition=None','--quiet') | Out-Null
Cloud @('artifacts','repositories','add-iam-policy-binding','plantsense','--location',$region,'--project',$project,'--member',"serviceAccount:$executor",'--role=roles/artifactregistry.writer','--quiet') | Out-Null
Cloud @('storage','buckets','add-iam-policy-binding',"gs://$bucket",'--project',$project,'--member',"serviceAccount:$executor",'--role=roles/storage.objectViewer','--quiet') | Out-Null
Cloud @('storage','buckets','add-iam-policy-binding',"gs://$bucket",'--project',$project,'--member',"serviceAccount:$submitter",'--role=roles/storage.objectUser','--quiet') | Out-Null
# gcloud builds submit reads bucket metadata before uploading the source archive.
Cloud @('storage','buckets','add-iam-policy-binding',"gs://$bucket",'--project',$project,'--member',"serviceAccount:$submitter",'--role=roles/storage.bucketViewer','--quiet') | Out-Null
Write-Output "PLANTSENSE_CLOUD_BUILD_ACCOUNT=projects/$project/serviceAccounts/$executor"
Write-Output "PLANTSENSE_BUILD_SOURCE_BUCKET=$bucket"
Write-Output 'Build resources ready. No build was submitted and no deployment or plant-data access was granted.'
