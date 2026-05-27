param(
  [string]$BaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Assert-Equal($actual, $expected, $message) {
  if ($actual -ne $expected) {
    throw "$message`nExpected: $expected`nActual:   $actual"
  }
}

function Assert-True($condition, $message) {
  if (-not $condition) {
    throw $message
  }
}

function Invoke-CurlJson {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "POST")]
    [string]$Method,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [object]$JsonBody = $null
  )

  $tempFile = [System.IO.Path]::GetTempFileName()
  $payloadFile = $null

  try {
    $curlArgs = @(
      "-sS",
      "-X", $Method,
      "-o", $tempFile,
      "-w", "%{http_code}",
      "$BaseUrl$Path"
    )

    if ($null -ne $JsonBody) {
      $payload = $JsonBody | ConvertTo-Json -Depth 10 -Compress
      $payloadFile = [System.IO.Path]::GetTempFileName()
      Set-Content -Path $payloadFile -Value $payload -Encoding UTF8 -NoNewline
      $curlArgs = @(
        "-sS",
        "-X", $Method,
        "-H", "Content-Type: application/json",
        "--data-binary", "@$payloadFile",
        "-o", $tempFile,
        "-w", "%{http_code}",
        "$BaseUrl$Path"
      )
    }

    $statusText = & curl.exe @curlArgs
    $statusCode = [int]$statusText
    $rawBody = Get-Content -Raw -Path $tempFile
    $json = $null

    if ($rawBody) {
      try {
        $json = $rawBody | ConvertFrom-Json
      }
      catch {
        throw "Response body is not valid JSON.`nHTTP Status: $statusCode`nRaw Body:`n$rawBody"
      }
    }

    return [PSCustomObject]@{
      StatusCode = $statusCode
      RawBody = $rawBody
      Json = $json
    }
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item $tempFile -Force
    }
    if ($null -ne $payloadFile -and (Test-Path $payloadFile)) {
      Remove-Item $payloadFile -Force
    }
  }
}

Write-Host "Checking docs API via curl.exe" -ForegroundColor Green
Write-Host "Base URL: $BaseUrl"
Write-Host "Note: HTTP status is checked separately from response JSON code."

$createEventId = "evt_auto_docs_001"
$createResponse = $null
$createdDocId = $null

Write-Step "POST /docs should create a document"
$createResponse = Invoke-CurlJson -Method "POST" -Path "/docs" -JsonBody @{
  title = "auto-test-doc"
  createdBy = "curl_script_user"
  eventId = $createEventId
}

Assert-Equal $createResponse.StatusCode 201 "POST /docs should return HTTP 201."
Assert-Equal $createResponse.Json.code 0 "POST /docs should return business code 0."
Assert-Equal $createResponse.Json.data.title "auto-test-doc" "Created title mismatch."
Assert-Equal $createResponse.Json.data.createdBy "curl_script_user" "CreatedBy mismatch."
Assert-Equal $createResponse.Json.data.currentSeq 0 "Initial currentSeq should be 0."
Assert-True ($null -ne $createResponse.Json.data.snapshot) "Snapshot should exist."
$createdDocId = $createResponse.Json.data.docId
Assert-True (-not [string]::IsNullOrWhiteSpace($createdDocId)) "docId should not be empty."
Write-Host "PASS POST /docs => HTTP 201, docId=$createdDocId" -ForegroundColor Green

Write-Step "GET /docs/:docId should return the created document"
$getDocResponse = Invoke-CurlJson -Method "GET" -Path "/docs/$createdDocId"

Assert-Equal $getDocResponse.StatusCode 200 "GET /docs/:docId should return HTTP 200."
Assert-Equal $getDocResponse.Json.code 0 "GET /docs/:docId should return business code 0."
Assert-Equal $getDocResponse.Json.data.docId $createdDocId "GET /docs/:docId returned wrong docId."
Write-Host "PASS GET /docs/$createdDocId => HTTP 200" -ForegroundColor Green

Write-Step "GET /docs should list created docs for the user"
$listResponse = Invoke-CurlJson -Method "GET" -Path "/docs?userId=curl_script_user&scope=created&page=1&pageSize=10"

Assert-Equal $listResponse.StatusCode 200 "GET /docs should return HTTP 200."
Assert-Equal $listResponse.Json.code 0 "GET /docs should return business code 0."
Assert-True ($listResponse.Json.data.total -ge 1) "GET /docs should return at least one record."

$matchedDoc = $listResponse.Json.data.list | Where-Object { $_.docId -eq $createdDocId } | Select-Object -First 1
Assert-True ($null -ne $matchedDoc) "Created doc should appear in the created docs list."
Assert-Equal $matchedDoc.relation "created" "Created doc relation should be 'created'."
Write-Host "PASS GET /docs => HTTP 200, created doc found" -ForegroundColor Green

Write-Step "POST /docs with duplicate eventId should be idempotent"
$duplicateResponse = Invoke-CurlJson -Method "POST" -Path "/docs" -JsonBody @{
  title = "should-be-ignored"
  createdBy = "other_user"
  eventId = $createEventId
}

Assert-Equal $duplicateResponse.StatusCode 201 "Duplicate POST /docs should still return HTTP 201."
Assert-Equal $duplicateResponse.Json.code 0 "Duplicate POST /docs should return business code 0."
Assert-Equal $duplicateResponse.Json.data.docId $createdDocId "Duplicate POST /docs should return the original docId."
Assert-Equal $duplicateResponse.Json.data.title "auto-test-doc" "Duplicate POST /docs should return the original title."
Write-Host "PASS duplicate POST /docs => HTTP 201, idempotent hit confirmed" -ForegroundColor Green

Write-Step "GET /docs/:docId for a missing doc should return 404"
$missingResponse = Invoke-CurlJson -Method "GET" -Path "/docs/doc_999999"

Assert-Equal $missingResponse.StatusCode 404 "Missing doc should return HTTP 404."
Assert-Equal $missingResponse.Json.code 4004 "Missing doc should return business code 4004."
Write-Host "PASS missing GET /docs/:docId => HTTP 404" -ForegroundColor Green

Write-Step "POST /docs with blank title should return 400"
$invalidTitleResponse = Invoke-CurlJson -Method "POST" -Path "/docs" -JsonBody @{
  title = "   "
}

Assert-Equal $invalidTitleResponse.StatusCode 400 "Blank title should return HTTP 400."
Assert-Equal $invalidTitleResponse.Json.code 4000 "Blank title should return business code 4000."
Write-Host "PASS invalid POST /docs => HTTP 400" -ForegroundColor Green

Write-Host ""
Write-Host "All docs API checks passed." -ForegroundColor Green
