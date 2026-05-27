param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$WsUrl = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WsUrl)) {
  $WsUrl = $BaseUrl -replace '^http://', 'ws://' -replace '^https://', 'wss://'
}

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
      $payload = $JsonBody | ConvertTo-Json -Depth 20 -Compress
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

function New-WsClient {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  $client = [System.Net.WebSockets.ClientWebSocket]::new()
  $null = $client.ConnectAsync([Uri]$Url, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
  return $client
}

function Close-WsClient {
  param(
    [Parameter(Mandatory = $true)]
    [System.Net.WebSockets.ClientWebSocket]$Client
  )

  try {
    if (
      $Client.State -eq [System.Net.WebSockets.WebSocketState]::Open -or
      $Client.State -eq [System.Net.WebSockets.WebSocketState]::CloseReceived
    ) {
      $null = $Client.CloseAsync(
        [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
        "bye",
        [System.Threading.CancellationToken]::None
      ).GetAwaiter().GetResult()
    }
  }
  catch {
  }
  finally {
    $Client.Dispose()
  }
}

function Send-WsJson {
  param(
    [Parameter(Mandatory = $true)]
    [System.Net.WebSockets.ClientWebSocket]$Client,

    [Parameter(Mandatory = $true)]
    [object]$Payload
  )

  $json = $Payload | ConvertTo-Json -Depth 20 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [System.ArraySegment[byte]]::new($bytes, 0, $bytes.Length)
  $null = $Client.SendAsync(
    $segment,
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [System.Threading.CancellationToken]::None
  ).GetAwaiter().GetResult()
}

function Receive-WsJson {
  param(
    [Parameter(Mandatory = $true)]
    [System.Net.WebSockets.ClientWebSocket]$Client,

    [int]$TimeoutMs = 4000
  )

  $buffer = New-Object byte[] 4096
  $stream = New-Object System.IO.MemoryStream
  $cts = [System.Threading.CancellationTokenSource]::new()
  $cts.CancelAfter($TimeoutMs)

  try {
    do {
      $segment = [System.ArraySegment[byte]]::new($buffer, 0, $buffer.Length)
      $result = $Client.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()

      if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
        throw "WebSocket server closed the connection."
      }

      if ($result.Count -gt 0) {
        $stream.Write($buffer, 0, $result.Count)
      }
    } until ($result.EndOfMessage)

    $raw = [System.Text.Encoding]::UTF8.GetString($stream.ToArray())

    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw "Received empty WebSocket payload."
    }

    try {
      $json = $raw | ConvertFrom-Json
    }
    catch {
      throw "Received invalid JSON from WebSocket.`nRaw Body:`n$raw"
    }

    return [PSCustomObject]@{
      Raw = $raw
      Json = $json
    }
  }
  catch [System.OperationCanceledException] {
    throw "Timed out waiting for WebSocket message after $TimeoutMs ms."
  }
  finally {
    $stream.Dispose()
    $cts.Dispose()
  }
}

function Receive-WsType {
  param(
    [Parameter(Mandatory = $true)]
    [System.Net.WebSockets.ClientWebSocket]$Client,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedType,

    [int]$TimeoutMs = 4000
  )

  $message = Receive-WsJson -Client $Client -TimeoutMs $TimeoutMs
  Assert-Equal $message.Json.type $ExpectedType "Unexpected WebSocket message type."
  return $message
}

Write-Host "Checking WebSocket API via ClientWebSocket" -ForegroundColor Green
Write-Host "HTTP Base URL: $BaseUrl"
Write-Host "WebSocket URL: $WsUrl"

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$createEventId = "evt_ws_script_$suffix"
$clientId = "ws_script_client_$suffix"
$verifierClientId = "ws_script_verifier_$suffix"
$createdDocId = $null
$ws = $null
$wsVerifier = $null

try {
  Write-Step "POST /docs should create an isolated document for WebSocket checks"
  $createResponse = Invoke-CurlJson -Method "POST" -Path "/docs" -JsonBody @{
    title = "ws-script-doc-$suffix"
    createdBy = "ws_script_user"
    eventId = $createEventId
  }

  Assert-Equal $createResponse.StatusCode 201 "POST /docs should return HTTP 201."
  Assert-Equal $createResponse.Json.code 0 "POST /docs should return business code 0."
  $createdDocId = $createResponse.Json.data.docId
  Assert-True (-not [string]::IsNullOrWhiteSpace($createdDocId)) "Created docId should not be empty."
  Write-Host "PASS POST /docs => HTTP 201, docId=$createdDocId" -ForegroundColor Green

  Write-Step "join should return join_ack and then presence"
  $ws = New-WsClient -Url $WsUrl
  Send-WsJson -Client $ws -Payload @{
    type = "join"
    docId = $createdDocId
    clientId = $clientId
    name = "WS Script User"
    color = "#2563eb"
  }

  $joinAck = Receive-WsType -Client $ws -ExpectedType "join_ack"
  Assert-Equal $joinAck.Json.code 0 "join_ack should return code 0."
  Assert-Equal $joinAck.Json.data.docId $createdDocId "join_ack returned wrong docId."
  Assert-Equal $joinAck.Json.data.clientId $clientId "join_ack returned wrong clientId."
  Assert-True ($null -ne $joinAck.Json.data.snapshot) "join_ack should include snapshot."
  Assert-True ($joinAck.Json.data.users.Count -ge 1) "join_ack should include at least one user."

  $joinPresence = Receive-WsType -Client $ws -ExpectedType "presence"
  Assert-Equal $joinPresence.Json.code 0 "join presence should return code 0."
  Assert-Equal $joinPresence.Json.data.docId $createdDocId "join presence returned wrong docId."
  $joinedUser = $joinPresence.Json.data.users | Where-Object { $_.clientId -eq $clientId } | Select-Object -First 1
  Assert-True ($null -ne $joinedUser) "Joined user should appear in presence users."
  Write-Host "PASS WS join => join_ack + presence" -ForegroundColor Green

  Write-Step "presence should return reply and room broadcast"
  Send-WsJson -Client $ws -Payload @{
    type = "presence"
    docId = $createdDocId
  }

  $presenceReply = Receive-WsType -Client $ws -ExpectedType "presence"
  $presenceBroadcast = Receive-WsType -Client $ws -ExpectedType "presence"
  Assert-Equal $presenceReply.Json.code 0 "presence reply should return code 0."
  Assert-Equal $presenceBroadcast.Json.code 0 "presence broadcast should return code 0."
  Assert-Equal $presenceReply.Json.data.docId $createdDocId "presence reply returned wrong docId."
  Assert-Equal $presenceBroadcast.Json.data.docId $createdDocId "presence broadcast returned wrong docId."
  Write-Host "PASS WS presence => reply + broadcast" -ForegroundColor Green

  Write-Step "set_cell should update a cell and return reply plus broadcast"
  Send-WsJson -Client $ws -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 1
    col = 1
    value = "hello from powershell"
    style = $null
  }

  $setCellReply = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  $setCellBroadcast = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  Assert-Equal $setCellReply.Json.code 0 "set_cell reply should return code 0."
  Assert-Equal $setCellReply.Json.data.docId $createdDocId "set_cell reply returned wrong docId."
  Assert-Equal $setCellReply.Json.data.clientId $clientId "set_cell reply returned wrong clientId."
  Assert-Equal $setCellReply.Json.data.row 1 "set_cell reply returned wrong row."
  Assert-Equal $setCellReply.Json.data.col 1 "set_cell reply returned wrong col."
  Assert-Equal $setCellReply.Json.data.value "hello from powershell" "set_cell reply returned wrong value."
  Assert-Equal $setCellReply.Json.data.seq $setCellBroadcast.Json.data.seq "set_cell reply and broadcast seq should match."
  $setCellSeq = $setCellReply.Json.data.seq
  Write-Host "PASS WS set_cell => reply + broadcast, seq=$setCellSeq" -ForegroundColor Green

  Write-Step "undo should restore the previous value"
  Send-WsJson -Client $ws -Payload @{
    type = "undo"
    docId = $createdDocId
    clientId = $clientId
  }

  $undoReply = Receive-WsType -Client $ws -ExpectedType "undo_applied"
  $undoBroadcast = Receive-WsType -Client $ws -ExpectedType "undo_applied"
  Assert-Equal $undoReply.Json.code 0 "undo reply should return code 0."
  Assert-True ($undoReply.Json.data.seq -gt $setCellSeq) "undo seq should be greater than set_cell seq."
  Assert-Equal $undoReply.Json.data.value "" "undo should restore the original empty value."
  Assert-Equal $undoReply.Json.data.seq $undoBroadcast.Json.data.seq "undo reply and broadcast seq should match."
  $undoSeq = $undoReply.Json.data.seq
  Write-Host "PASS WS undo => reply + broadcast, seq=$undoSeq" -ForegroundColor Green

  Write-Step "redo should re-apply the previous set_cell value"
  Send-WsJson -Client $ws -Payload @{
    type = "redo"
    docId = $createdDocId
    clientId = $clientId
  }

  $redoReply = Receive-WsType -Client $ws -ExpectedType "redo_applied"
  $redoBroadcast = Receive-WsType -Client $ws -ExpectedType "redo_applied"
  Assert-Equal $redoReply.Json.code 0 "redo reply should return code 0."
  Assert-True ($redoReply.Json.data.seq -gt $undoSeq) "redo seq should be greater than undo seq."
  Assert-Equal $redoReply.Json.data.value "hello from powershell" "redo should restore the set_cell value."
  Assert-Equal $redoReply.Json.data.seq $redoBroadcast.Json.data.seq "redo reply and broadcast seq should match."
  $redoSeq = $redoReply.Json.data.seq
  Write-Host "PASS WS redo => reply + broadcast, seq=$redoSeq" -ForegroundColor Green

  Write-Step "import_sheet should replace snapshot and return reply plus broadcast"
  Send-WsJson -Client $ws -Payload @{
    type = "import_sheet"
    docId = $createdDocId
    clientId = $clientId
    eventId = "evt_import_$suffix"
    snapshot = @{
      rowCount = 2
      colCount = 2
      cells = @{
        "1:1" = @{
          value = "Name"
          style = $null
        }
        "1:2" = @{
          value = "Score"
          style = $null
        }
        "2:1" = @{
          value = "Alice"
          style = $null
        }
        "2:2" = @{
          value = "99"
          style = $null
        }
      }
    }
  }

  $importReply = Receive-WsType -Client $ws -ExpectedType "sheet_imported"
  $importBroadcast = Receive-WsType -Client $ws -ExpectedType "sheet_imported"
  Assert-Equal $importReply.Json.code 0 "import_sheet reply should return code 0."
  Assert-True ($importReply.Json.data.seq -gt $redoSeq) "import_sheet seq should be greater than redo seq."
  Assert-Equal $importReply.Json.data.canUndo $false "import_sheet should clear undo state."
  Assert-Equal $importReply.Json.data.seq $importBroadcast.Json.data.seq "import_sheet reply and broadcast seq should match."
  Write-Host "PASS WS import_sheet => reply + broadcast, seq=$($importReply.Json.data.seq)" -ForegroundColor Green

  Close-WsClient -Client $ws
  $ws = $null

  Write-Step "A fresh join should observe the imported snapshot"
  $wsVerifier = New-WsClient -Url $WsUrl
  Send-WsJson -Client $wsVerifier -Payload @{
    type = "join"
    docId = $createdDocId
    clientId = $verifierClientId
    name = "WS Verifier"
  }

  $verifyJoinAck = Receive-WsType -Client $wsVerifier -ExpectedType "join_ack"
  $verifyPresence = Receive-WsType -Client $wsVerifier -ExpectedType "presence"
  Assert-Equal $verifyJoinAck.Json.code 0 "Verifier join_ack should return code 0."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.rowCount 2 "Imported snapshot rowCount mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.colCount 2 "Imported snapshot colCount mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'1:1'.value "Name" "Imported snapshot cell 1:1 mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'2:2'.value "99" "Imported snapshot cell 2:2 mismatch."
  Assert-Equal $verifyPresence.Json.code 0 "Verifier presence should return code 0."
  Write-Host "PASS WS rejoin => imported snapshot visible" -ForegroundColor Green

  Write-Step "Unsupported message type should return error 4001"
  Send-WsJson -Client $wsVerifier -Payload @{
    type = "unknown_type"
  }

  $unsupportedReply = Receive-WsType -Client $wsVerifier -ExpectedType "error"
  Assert-Equal $unsupportedReply.Json.code 4001 "Unsupported message type should return error 4001."
  Assert-Equal $unsupportedReply.Json.message "Unsupported message type" "Unsupported message type error message mismatch."
  Write-Host "PASS WS invalid type => error 4001" -ForegroundColor Green

  Write-Host ""
  Write-Host "All WebSocket API checks passed." -ForegroundColor Green
}
finally {
  if ($null -ne $wsVerifier) {
    Close-WsClient -Client $wsVerifier
  }
  if ($null -ne $ws) {
    Close-WsClient -Client $ws
  }
}
