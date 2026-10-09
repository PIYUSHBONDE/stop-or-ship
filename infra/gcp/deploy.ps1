param(
  [Parameter(Mandatory=$true)][string]$Project,
  [Parameter(Mandatory=$true)][string]$FirebaseApiKey,
  [string]$Region = 'us-central1',
  [string]$Model = 'gemini-3.5-flash'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $projectRoot
function Cloud([string[]]$Arguments) {
  & gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments[0]) $($Arguments[1])" }
}
$active = & gcloud auth list --filter=status:ACTIVE --format='value(account)'
if (-not $active) { throw 'No active Google Cloud login. Run gcloud auth login and gcloud auth application-default login first.' }
if (-not (Test-Path -LiteralPath 'backend/data/artifacts/replay.json')) { throw 'Prepare and validate the measured dataset first.' }
if (-not (Test-Path -LiteralPath 'backend/uv.lock')) { throw 'Generate the backend dependency lock first.' }

Cloud @('services','enable','run.googleapis.com','cloudbuild.googleapis.com','artifactregistry.googleapis.com','firestore.googleapis.com','aiplatform.googleapis.com','cloudtasks.googleapis.com','storage.googleapis.com','identitytoolkit.googleapis.com','firebase.googleapis.com','--project',$Project)
$number = & gcloud projects describe $Project --format='value(projectNumber)'
if ($LASTEXITCODE -ne 0) { throw 'Could not read project number.' }
foreach ($name in @('plantsense-api','plantsense-worker','plantsense-task')) {
  & gcloud iam service-accounts describe "$name@$Project.iam.gserviceaccount.com" --project=$Project 2>$null
  if ($LASTEXITCODE -ne 0) { Cloud @('iam','service-accounts','create',$name,'--project',$Project) }
}
$apiAccount = "plantsense-api@$Project.iam.gserviceaccount.com"
$workerAccount = "plantsense-worker@$Project.iam.gserviceaccount.com"
$taskAccount = "plantsense-task@$Project.iam.gserviceaccount.com"
foreach ($account in @($apiAccount,$workerAccount)) {
  foreach ($role in @('roles/datastore.user','roles/aiplatform.user')) {
    Cloud @('projects','add-iam-policy-binding',$Project,'--member',"serviceAccount:$account",'--role',$role,'--condition=None')
  }
}
Cloud @('projects','add-iam-policy-binding',$Project,'--member',"serviceAccount:$apiAccount",'--role','roles/cloudtasks.enqueuer','--condition=None')
Cloud @('iam','service-accounts','add-iam-policy-binding',$taskAccount,'--member',"serviceAccount:$apiAccount",'--role','roles/iam.serviceAccountUser','--project',$Project)
Cloud @('iam','service-accounts','add-iam-policy-binding',$taskAccount,'--member',"serviceAccount:service-$number@gcp-sa-cloudtasks.iam.gserviceaccount.com",'--role','roles/iam.serviceAccountTokenCreator','--project',$Project)

& gcloud artifacts repositories describe plantsense --location=$Region --project=$Project 2>$null
if ($LASTEXITCODE -ne 0) { Cloud @('artifacts','repositories','create','plantsense','--repository-format=docker','--location',$Region,'--project',$Project) }
$backendImage = "$Region-docker.pkg.dev/$Project/plantsense/backend:release"
$webImage = "$Region-docker.pkg.dev/$Project/plantsense/web:release"
Cloud @('builds','submit','--config','infra/gcp/cloudbuild-backend.yaml','--substitutions',"_IMAGE=$backendImage",'--project',$Project,'.')
$sharedEnv = "PLANTSENSE_MODE=cloud,GOOGLE_CLOUD_PROJECT=$Project,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=$Model,DAILY_AI_LIMIT=60"
Cloud @('run','deploy','plantsense-worker','--image',$backendImage,'--region',$Region,'--project',$Project,'--service-account',$workerAccount,'--no-allow-unauthenticated','--memory','1Gi','--cpu','1','--concurrency','1','--min-instances','0','--max-instances','2','--timeout','90','--set-env-vars',"$sharedEnv,SERVICE_ROLE=worker")
$workerUrl = & gcloud run services describe plantsense-worker --region=$Region --project=$Project --format='value(status.url)'
if ($LASTEXITCODE -ne 0) { throw 'Could not read worker URL.' }
Cloud @('run','services','add-iam-policy-binding','plantsense-worker','--region',$Region,'--project',$Project,'--member',"serviceAccount:$taskAccount",'--role','roles/run.invoker')
& gcloud tasks queues describe plantsense-investigations --location=$Region --project=$Project 2>$null
if ($LASTEXITCODE -ne 0) { Cloud @('tasks','queues','create','plantsense-investigations','--location',$Region,'--project',$Project) }
Cloud @('tasks','queues','update','plantsense-investigations','--location',$Region,'--project',$Project,'--max-attempts','2','--max-concurrent-dispatches','2','--max-dispatches-per-second','1','--min-backoff','10s','--max-backoff','20s')
Cloud @('run','deploy','plantsense-api','--image',$backendImage,'--region',$Region,'--project',$Project,'--service-account',$apiAccount,'--allow-unauthenticated','--memory','1Gi','--cpu','1','--concurrency','10','--min-instances','0','--max-instances','2','--timeout','75','--set-env-vars',"$sharedEnv,SERVICE_ROLE=api,WORKER_URL=$workerUrl,TASK_REGION=$Region,TASK_SERVICE_ACCOUNT=$taskAccount")
$apiUrl = & gcloud run services describe plantsense-api --region=$Region --project=$Project --format='value(status.url)'
if ($LASTEXITCODE -ne 0) { throw 'Could not read API URL.' }
Cloud @('builds','submit','--config','infra/gcp/cloudbuild-web.yaml','--substitutions',"_IMAGE=$webImage,_FIREBASE_API_KEY=$FirebaseApiKey,_FIREBASE_AUTH_DOMAIN=$Project.firebaseapp.com",'--project',$Project,'.')
Cloud @('run','deploy','plantsense-web','--image',$webImage,'--region',$Region,'--project',$Project,'--allow-unauthenticated','--memory','512Mi','--cpu','1','--concurrency','20','--min-instances','0','--max-instances','2','--set-env-vars',"API_BASE_URL=$apiUrl,NEXT_TELEMETRY_DISABLED=1")
Cloud @('run','services','describe','plantsense-web','--region',$Region,'--project',$Project,'--format=value(status.url)')
Write-Host 'Deployment complete. Follow docs/operations/deployment.md to verify Firebase anonymous auth, knowledge index, budget alerts, and the live workflow.'
