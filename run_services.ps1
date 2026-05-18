Set-Location 'C:\realize attendent automate system\apps\api'
$p1 = Start-Process -NoNewWindow -FilePath 'npx.cmd' -ArgumentList 'tsx src/server.ts' -PassThru
Start-Sleep -Seconds 3
Set-Location 'C:\realize attendent automate system\apps\web'
$p2 = Start-Process -NoNewWindow -FilePath 'npx.cmd' -ArgumentList 'next start --port 3000' -PassThru
Write-Output "PID1=$($p1.Id) PID2=$($p2.Id)"
$p1.WaitForExit()
