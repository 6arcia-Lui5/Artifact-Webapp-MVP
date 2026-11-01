# Builds a light Vercel deployment of the date/region service: baseline model only, no PyTorch.
$r = Resolve-Path (Join-Path $PSScriptRoot '..\..'); $o = Join-Path $r '.local\hosted-rollout\ml-deploy'
New-Item -ItemType Directory -Force "$o\api","$o\models","$o\reports" | Out-Null
foreach ($f in 'predictor.py','build_dataset.py','labels.py','service.py') { Copy-Item "$r\ml\$f" $o -Force }
Copy-Item "$r\ml\models\baseline.joblib" "$o\models\" -Force
Copy-Item "$r\ml\reports\*.json" "$o\reports\" -Force
if (Test-Path "$r\ml\demo") { Copy-Item "$r\ml\demo" $o -Recurse -Force }
[IO.File]::WriteAllText("$o\requirements.txt", "lxml>=5.0`npandas>=2.0`nnumpy>=1.26`nscikit-learn==1.9.1`njoblib>=1.3`nfastapi>=0.110`npydantic>=2.0`npyarrow>=14`n")
[IO.File]::WriteAllText("$o\.python-version", "3.12`n")
[IO.File]::WriteAllText("$o\api\index.py", "import sys`nfrom pathlib import Path`nsys.path.insert(0, str(Path(__file__).resolve().parent.parent))`nfrom service import app`n")
[IO.File]::WriteAllText("$o\vercel.json", '{"rewrites":[{"source":"/(.*)","destination":"/api/index"}],"functions":{"api/index.py":{"maxDuration":30,"includeFiles":"{models,reports,demo}/**"}}}')
Get-ChildItem $o -Recurse -File | Measure-Object Length -Sum | ForEach-Object { "files $($_.Count), $([math]::Round($_.Sum/1MB,1)) MB" }
