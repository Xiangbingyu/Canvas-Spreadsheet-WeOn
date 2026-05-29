param(
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$WsUrl = "",
  [string]$SecondaryBaseUrl = "",
  [string]$SecondaryWsUrl = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($WsUrl)) {
  $WsUrl = $BaseUrl -replace '^http://', 'ws://' -replace '^https://', 'wss://'
}

if (-not [string]::IsNullOrWhiteSpace($SecondaryBaseUrl) -and [string]::IsNullOrWhiteSpace($SecondaryWsUrl)) {
  $SecondaryWsUrl = $SecondaryBaseUrl -replace '^http://', 'ws://' -replace '^https://', 'wss://'
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

    [object]$JsonBody = $null,

    [string]$TargetBaseUrl = $BaseUrl
  )

  $tempFile = [System.IO.Path]::GetTempFileName()
  $payloadFile = $null

  try {
    $curlArgs = @(
      "-sS",
      "-X", $Method,
      "-o", $tempFile,
      "-w", "%{http_code}",
      "$TargetBaseUrl$Path"
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
        "$TargetBaseUrl$Path"
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

  $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
  $unexpectedTypes = New-Object System.Collections.Generic.List[string]

  while ([DateTime]::UtcNow -lt $deadline) {
    $remainingMs = [Math]::Max([int]([Math]::Ceiling(($deadline - [DateTime]::UtcNow).TotalMilliseconds)), 1)
    $message = Receive-WsJson -Client $Client -TimeoutMs $remainingMs

    if ($message.Json.type -eq $ExpectedType) {
      return $message
    }

    $unexpectedTypes.Add([string]$message.Json.type)
  }

  $joinedTypes = [string]::Join(", ", $unexpectedTypes)
  throw "Timed out waiting for WebSocket message type '$ExpectedType'. Unexpected types seen: $joinedTypes"
}

Write-Host "Checking WebSocket API via ClientWebSocket" -ForegroundColor Green
Write-Host "HTTP Base URL: $BaseUrl"
Write-Host "WebSocket URL: $WsUrl"
if (-not [string]::IsNullOrWhiteSpace($SecondaryBaseUrl)) {
  Write-Host "Secondary HTTP Base URL: $SecondaryBaseUrl"
}
if (-not [string]::IsNullOrWhiteSpace($SecondaryWsUrl)) {
  Write-Host "Secondary WebSocket URL: $SecondaryWsUrl"
}

$suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$createEventId = "evt_ws_script_$suffix"
$clientId = "ws_script_client_$suffix"
$secondaryClientId = "ws_script_secondary_$suffix"
$verifierClientId = "ws_script_verifier_$suffix"
$createdDocId = $null
$ws = $null
$wsSecondary = $null
$wsVerifier = $null
$wsUnauthorized = $null
$verifierWsUrl = if (-not [string]::IsNullOrWhiteSpace($SecondaryWsUrl)) { $SecondaryWsUrl } else { $WsUrl }
$verifierBaseUrl = if (-not [string]::IsNullOrWhiteSpace($SecondaryBaseUrl)) { $SecondaryBaseUrl } else { $BaseUrl }

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

  Write-Step "Before join, set_cell / set_title / undo / redo should all return error 4003"
  $wsUnauthorized = New-WsClient -Url $WsUrl

  Send-WsJson -Client $wsUnauthorized -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 1
    col = 1
    value = "should-fail-before-join"
  }
  $beforeJoinSetCell = Receive-WsType -Client $wsUnauthorized -ExpectedType "error"
  Assert-Equal $beforeJoinSetCell.Json.code 4003 "set_cell before join should return error 4003."

  Send-WsJson -Client $wsUnauthorized -Payload @{
    type = "set_title"
    docId = $createdDocId
    clientId = $clientId
    title = "should-fail-before-join"
  }
  $beforeJoinSetTitle = Receive-WsType -Client $wsUnauthorized -ExpectedType "error"
  Assert-Equal $beforeJoinSetTitle.Json.code 4003 "set_title before join should return error 4003."

  Send-WsJson -Client $wsUnauthorized -Payload @{
    type = "undo"
    docId = $createdDocId
    clientId = $clientId
  }
  $beforeJoinUndo = Receive-WsType -Client $wsUnauthorized -ExpectedType "error"
  Assert-Equal $beforeJoinUndo.Json.code 4003 "undo before join should return error 4003."

  Send-WsJson -Client $wsUnauthorized -Payload @{
    type = "redo"
    docId = $createdDocId
    clientId = $clientId
  }
  $beforeJoinRedo = Receive-WsType -Client $wsUnauthorized -ExpectedType "error"
  Assert-Equal $beforeJoinRedo.Json.code 4003 "redo before join should return error 4003."

  Close-WsClient -Client $wsUnauthorized
  $wsUnauthorized = $null
  Write-Host "PASS WS before join => set_cell / set_title / undo / redo all forbidden" -ForegroundColor Green

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
  Assert-Equal $joinAck.Json.data.snapshot.id "sheet_${createdDocId}_001" "join_ack returned wrong initial snapshot id."
  Assert-Equal $joinAck.Json.data.snapshot.name "Sheet1" "join_ack returned wrong initial snapshot name."
  Assert-Equal $joinAck.Json.data.snapshot.defaultRowHeight 25 "join_ack returned wrong defaultRowHeight."
  Assert-Equal $joinAck.Json.data.snapshot.defaultColWidth 100 "join_ack returned wrong defaultColWidth."
  Assert-True ($joinAck.Json.data.users.Count -ge 1) "join_ack should include at least one user."

  $joinPresence = Receive-WsType -Client $ws -ExpectedType "presence"
  Assert-Equal $joinPresence.Json.code 0 "join presence should return code 0."
  Assert-Equal $joinPresence.Json.data.docId $createdDocId "join presence returned wrong docId."
  $joinedUser = $joinPresence.Json.data.users | Where-Object { $_.clientId -eq $clientId } | Select-Object -First 1
  Assert-True ($null -ne $joinedUser) "Joined user should appear in presence users."
  Write-Host "PASS WS join => join_ack + presence" -ForegroundColor Green

  if (-not [string]::IsNullOrWhiteSpace($SecondaryWsUrl)) {
    Write-Step "Secondary instance join should observe the same room and publish cross-instance presence"
    $wsSecondary = New-WsClient -Url $SecondaryWsUrl
    Send-WsJson -Client $wsSecondary -Payload @{
      type = "join"
      docId = $createdDocId
      clientId = $secondaryClientId
      name = "WS Secondary User"
      color = "#16a34a"
    }

    $secondaryJoinAck = Receive-WsType -Client $wsSecondary -ExpectedType "join_ack"
    $secondaryJoinPresence = Receive-WsType -Client $wsSecondary -ExpectedType "presence"
    Assert-Equal $secondaryJoinAck.Json.code 0 "Secondary join_ack should return code 0."
    Assert-Equal $secondaryJoinAck.Json.data.docId $createdDocId "Secondary join_ack returned wrong docId."
    Assert-Equal $secondaryJoinAck.Json.data.clientId $secondaryClientId "Secondary join_ack returned wrong clientId."
    Assert-Equal $secondaryJoinPresence.Json.code 0 "Secondary join presence should return code 0."
    $secondaryJoinedUser = $secondaryJoinPresence.Json.data.users | Where-Object { $_.clientId -eq $secondaryClientId } | Select-Object -First 1
    Assert-True ($null -ne $secondaryJoinedUser) "Secondary joined user should appear in secondary presence."

    $primaryCrossPresence = Receive-WsType -Client $ws -ExpectedType "presence"
    $primaryCrossUser = $primaryCrossPresence.Json.data.users | Where-Object { $_.clientId -eq $secondaryClientId } | Select-Object -First 1
    Assert-True ($null -ne $primaryCrossUser) "Primary client should observe the secondary user via cross-instance presence."
    Write-Host "PASS secondary join => cross-instance presence visible" -ForegroundColor Green
  }

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
    baseSeq = $joinAck.Json.data.currentSeq
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
  if ($null -ne $wsSecondary) {
    $setCellSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "cell_updated"
    Assert-Equal $setCellSecondaryBroadcast.Json.data.seq $setCellReply.Json.data.seq "Cross-instance set_cell broadcast seq should match."
    Assert-Equal $setCellSecondaryBroadcast.Json.data.value "hello from powershell" "Cross-instance set_cell broadcast returned wrong value."
  }
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
  if ($null -ne $wsSecondary) {
    $undoSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "undo_applied"
    Assert-Equal $undoSecondaryBroadcast.Json.data.seq $undoReply.Json.data.seq "Cross-instance undo broadcast seq should match."
  }
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
  if ($null -ne $wsSecondary) {
    $redoSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "redo_applied"
    Assert-Equal $redoSecondaryBroadcast.Json.data.seq $redoReply.Json.data.seq "Cross-instance redo broadcast seq should match."
  }
  $redoSeq = $redoReply.Json.data.seq
  Write-Host "PASS WS redo => reply + broadcast, seq=$redoSeq" -ForegroundColor Green

  Write-Step "stale baseSeq set_cell should still succeed on the latest document state"
  $staleCellBaseSeq = $redoSeq
  Send-WsJson -Client $ws -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 2
    col = 2
    value = "base-seq-first"
    style = $null
    baseSeq = $staleCellBaseSeq
  }
  $baseSeqCellReplyA = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  $baseSeqCellBroadcastA = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  Assert-Equal $baseSeqCellReplyA.Json.data.seq $baseSeqCellBroadcastA.Json.data.seq "First baseSeq set_cell reply and broadcast seq should match."
  if ($null -ne $wsSecondary) {
    $baseSeqCellSecondaryBroadcastA = Receive-WsType -Client $wsSecondary -ExpectedType "cell_updated"
    Assert-Equal $baseSeqCellSecondaryBroadcastA.Json.data.seq $baseSeqCellReplyA.Json.data.seq "First cross-instance baseSeq set_cell seq should match."
  }

  Send-WsJson -Client $ws -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 2
    col = 2
    value = "base-seq-second"
    style = $null
    baseSeq = $staleCellBaseSeq
  }
  $baseSeqCellReplyB = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  $baseSeqCellBroadcastB = Receive-WsType -Client $ws -ExpectedType "cell_updated"
  Assert-Equal $baseSeqCellReplyB.Json.code 0 "Stale baseSeq set_cell should return code 0."
  Assert-Equal $baseSeqCellReplyB.Json.data.value "base-seq-second" "Stale baseSeq set_cell returned wrong value."
  Assert-Equal $baseSeqCellReplyB.Json.data.seq $baseSeqCellBroadcastB.Json.data.seq "Stale baseSeq set_cell reply and broadcast seq should match."
  Assert-True ($baseSeqCellReplyB.Json.data.seq -gt $baseSeqCellReplyA.Json.data.seq) "Stale baseSeq set_cell should advance seq."
  if ($null -ne $wsSecondary) {
    $baseSeqCellSecondaryBroadcastB = Receive-WsType -Client $wsSecondary -ExpectedType "cell_updated"
    Assert-Equal $baseSeqCellSecondaryBroadcastB.Json.data.seq $baseSeqCellReplyB.Json.data.seq "Second cross-instance baseSeq set_cell seq should match."
    Assert-Equal $baseSeqCellSecondaryBroadcastB.Json.data.value "base-seq-second" "Second cross-instance baseSeq set_cell returned wrong value."
  }
  $staleCellSeq = $baseSeqCellReplyB.Json.data.seq

  Send-WsJson -Client $ws -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 3
    col = 3
    value = "future-base-seq-should-fail"
    style = $null
    baseSeq = $staleCellSeq + 10
  }
  $futureBaseSeqCellError = Receive-WsType -Client $ws -ExpectedType "error"
  Assert-Equal $futureBaseSeqCellError.Json.code 4090 "Future baseSeq set_cell should return error 4090."
  Write-Host "PASS WS set_cell baseSeq => stale request re-applied, future baseSeq rejected" -ForegroundColor Green

  Write-Step "set_title should support baseSeq and persist the latest title"
  $updatedTitle = "ws-script-title-$suffix"
  Send-WsJson -Client $ws -Payload @{
    type = "set_title"
    docId = $createdDocId
    clientId = $clientId
    title = $updatedTitle
    baseSeq = $staleCellSeq
  }

  $setTitleReply = Receive-WsType -Client $ws -ExpectedType "title_updated"
  $setTitleBroadcast = Receive-WsType -Client $ws -ExpectedType "title_updated"
  Assert-Equal $setTitleReply.Json.code 0 "set_title reply should return code 0."
  Assert-Equal $setTitleReply.Json.data.docId $createdDocId "set_title reply returned wrong docId."
  Assert-Equal $setTitleReply.Json.data.clientId $clientId "set_title reply returned wrong clientId."
  Assert-Equal $setTitleReply.Json.data.title $updatedTitle "set_title reply returned wrong title."
  Assert-Equal $setTitleReply.Json.data.seq $setTitleBroadcast.Json.data.seq "set_title reply and broadcast seq should match."
  Assert-True ($setTitleReply.Json.data.seq -gt $staleCellSeq) "set_title seq should be greater than stale baseSeq set_cell seq."
  if ($null -ne $wsSecondary) {
    $setTitleSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "title_updated"
    Assert-Equal $setTitleSecondaryBroadcast.Json.data.seq $setTitleReply.Json.data.seq "Cross-instance set_title broadcast seq should match."
    Assert-Equal $setTitleSecondaryBroadcast.Json.data.title $updatedTitle "Cross-instance set_title returned wrong title."
  }

  $rebasedTitle = "ws-script-title-rebased-$suffix"
  Send-WsJson -Client $ws -Payload @{
    type = "set_title"
    docId = $createdDocId
    clientId = $clientId
    title = $rebasedTitle
    baseSeq = $staleCellSeq
  }

  $rebasedTitleReply = Receive-WsType -Client $ws -ExpectedType "title_updated"
  $rebasedTitleBroadcast = Receive-WsType -Client $ws -ExpectedType "title_updated"
  Assert-Equal $rebasedTitleReply.Json.code 0 "Stale baseSeq set_title should return code 0."
  Assert-Equal $rebasedTitleReply.Json.data.title $rebasedTitle "Stale baseSeq set_title returned wrong title."
  Assert-Equal $rebasedTitleReply.Json.data.seq $rebasedTitleBroadcast.Json.data.seq "Stale baseSeq set_title reply and broadcast seq should match."
  if ($null -ne $wsSecondary) {
    $rebasedTitleSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "title_updated"
    Assert-Equal $rebasedTitleSecondaryBroadcast.Json.data.seq $rebasedTitleReply.Json.data.seq "Cross-instance stale baseSeq set_title seq should match."
  }

  Send-WsJson -Client $ws -Payload @{
    type = "set_title"
    docId = $createdDocId
    clientId = $clientId
    title = "future-title-should-fail"
    baseSeq = $rebasedTitleReply.Json.data.seq + 10
  }
  $futureBaseSeqTitleError = Receive-WsType -Client $ws -ExpectedType "error"
  Assert-Equal $futureBaseSeqTitleError.Json.code 4090 "Future baseSeq set_title should return error 4090."

  $docStateAfterTitle = Invoke-CurlJson -Method "GET" -Path "/docs/$createdDocId"
  Assert-Equal $docStateAfterTitle.StatusCode 200 "GET /docs/:docId after set_title should return HTTP 200."
  Assert-Equal $docStateAfterTitle.Json.code 0 "GET /docs/:docId after set_title should return business code 0."
  Assert-Equal $docStateAfterTitle.Json.data.docId $createdDocId "GET /docs/:docId after set_title returned wrong docId."
  Assert-Equal $docStateAfterTitle.Json.data.title $rebasedTitle "GET /docs/:docId after set_title returned wrong title."
  Assert-Equal $docStateAfterTitle.Json.data.currentSeq $rebasedTitleReply.Json.data.seq "GET /docs/:docId after set_title returned wrong seq."
  Write-Host "PASS WS set_title baseSeq => latest title persisted and future baseSeq rejected" -ForegroundColor Green

  Write-Step "import_sheet should replace snapshot and return reply plus broadcast"
  Send-WsJson -Client $ws -Payload @{
    type = "import_sheet"
    docId = $createdDocId
    clientId = $clientId
    eventId = "evt_import_$suffix"
    snapshot = @{
      id = "sheet_imported_$suffix"
      name = "Imported Sheet"
      defaultRowHeight = 28
      defaultColWidth = 120
      rowCount = 2
      colCount = 2
      styles = @{
        style_header = @{
          bold = $true
          color = "#ffffff"
          bgColor = "#2563eb"
        }
        style_value = @{
          hAlign = "right"
        }
      }
      cells = @{
        "1:1" = @{
          row = 1
          col = 1
          value = "Name"
          styleId = "style_header"
        }
        "1:2" = @{
          row = 1
          col = 2
          value = "Score"
          styleId = "style_header"
        }
        "2:1" = @{
          row = 2
          col = 1
          value = "Alice"
          styleId = $null
        }
        "2:2" = @{
          row = 2
          col = 2
          value = "99"
          styleId = "style_value"
        }
      }
    }
  }

  $importReply = Receive-WsType -Client $ws -ExpectedType "sheet_imported"
  $importBroadcast = Receive-WsType -Client $ws -ExpectedType "sheet_imported"
  Assert-Equal $importReply.Json.code 0 "import_sheet reply should return code 0."
  Assert-True ($importReply.Json.data.seq -gt $rebasedTitleReply.Json.data.seq) "import_sheet seq should be greater than set_title seq."
  Assert-Equal $importReply.Json.data.snapshot.id "sheet_imported_$suffix" "import_sheet reply snapshot id mismatch."
  Assert-Equal $importReply.Json.data.snapshot.name "Imported Sheet" "import_sheet reply snapshot name mismatch."
  Assert-Equal $importReply.Json.data.snapshot.defaultRowHeight 28 "import_sheet reply snapshot defaultRowHeight mismatch."
  Assert-Equal $importReply.Json.data.snapshot.defaultColWidth 120 "import_sheet reply snapshot defaultColWidth mismatch."
  Assert-Equal $importReply.Json.data.snapshot.cells.'1:1'.value "Name" "import_sheet reply snapshot cell 1:1 mismatch."
  Assert-Equal $importBroadcast.Json.data.snapshot.id $importReply.Json.data.snapshot.id "import_sheet reply and broadcast snapshot id should match."
  Assert-Equal $importReply.Json.data.canUndo $false "import_sheet should clear undo state."
  Assert-Equal $importReply.Json.data.seq $importBroadcast.Json.data.seq "import_sheet reply and broadcast seq should match."
  if ($null -ne $wsSecondary) {
    $importSecondaryBroadcast = Receive-WsType -Client $wsSecondary -ExpectedType "sheet_imported"
    Assert-Equal $importSecondaryBroadcast.Json.data.seq $importReply.Json.data.seq "Cross-instance import_sheet broadcast seq should match."
    Assert-Equal $importSecondaryBroadcast.Json.data.snapshot.id $importReply.Json.data.snapshot.id "Cross-instance import_sheet snapshot id should match."
  }
  Write-Host "PASS WS import_sheet => reply + broadcast, seq=$($importReply.Json.data.seq)" -ForegroundColor Green

  Write-Step "set_cell with a stale pre-import baseSeq should return error 4090"
  Send-WsJson -Client $ws -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $clientId
    row = 1
    col = 1
    value = "should-fail-after-import"
    style = $null
    baseSeq = $rebasedTitleReply.Json.data.seq
  }
  $afterImportBarrierError = Receive-WsType -Client $ws -ExpectedType "error"
  Assert-Equal $afterImportBarrierError.Json.code 4090 "Stale baseSeq after import_sheet should return error 4090."
  Write-Host "PASS WS import_sheet barrier => stale pre-import baseSeq rejected" -ForegroundColor Green

  Close-WsClient -Client $ws
  $ws = $null

  Write-Step "A fresh join should observe the imported snapshot"
  $wsVerifier = New-WsClient -Url $verifierWsUrl
  Send-WsJson -Client $wsVerifier -Payload @{
    type = "join"
    docId = $createdDocId
    clientId = $verifierClientId
    name = "WS Verifier"
  }

  $verifyJoinAck = Receive-WsType -Client $wsVerifier -ExpectedType "join_ack"
  $verifyPresence = Receive-WsType -Client $wsVerifier -ExpectedType "presence"
  Assert-Equal $verifyJoinAck.Json.code 0 "Verifier join_ack should return code 0."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.id "sheet_imported_$suffix" "Imported snapshot id mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.name "Imported Sheet" "Imported snapshot name mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.defaultRowHeight 28 "Imported snapshot defaultRowHeight mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.defaultColWidth 120 "Imported snapshot defaultColWidth mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.rowCount 2 "Imported snapshot rowCount mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.colCount 2 "Imported snapshot colCount mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'1:1'.row 1 "Imported snapshot cell 1:1 row mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'1:1'.col 1 "Imported snapshot cell 1:1 col mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'1:1'.value "Name" "Imported snapshot cell 1:1 mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'1:1'.styleId "style_header" "Imported snapshot cell 1:1 styleId mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'2:2'.value "99" "Imported snapshot cell 2:2 mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.cells.'2:2'.styleId "style_value" "Imported snapshot cell 2:2 styleId mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.styles.style_header.bgColor "#2563eb" "Imported snapshot style_header mismatch."
  Assert-Equal $verifyJoinAck.Json.data.snapshot.styles.style_value.hAlign "right" "Imported snapshot style_value mismatch."
  Assert-Equal $verifyPresence.Json.code 0 "Verifier presence should return code 0."
  Write-Host "PASS WS rejoin => imported snapshot visible" -ForegroundColor Green

  Write-Step "After switching room, old room operations should return error 4003"
  $switchDocResponse = Invoke-CurlJson -Method "POST" -Path "/docs" -TargetBaseUrl $verifierBaseUrl -JsonBody @{
    title = "ws-switch-doc-$suffix"
    createdBy = "ws_script_user"
    eventId = "evt_ws_switch_$suffix"
  }
  Assert-Equal $switchDocResponse.StatusCode 201 "POST /docs for room switch should return HTTP 201."
  $switchDocId = $switchDocResponse.Json.data.docId
  Assert-True (-not [string]::IsNullOrWhiteSpace($switchDocId)) "Switch target docId should not be empty."

  Send-WsJson -Client $wsVerifier -Payload @{
    type = "join"
    docId = $switchDocId
    clientId = $verifierClientId
    name = "WS Verifier"
  }
  $switchJoinAck = Receive-WsType -Client $wsVerifier -ExpectedType "join_ack"
  $switchPresence = Receive-WsType -Client $wsVerifier -ExpectedType "presence"
  Assert-Equal $switchJoinAck.Json.code 0 "Switch join_ack should return code 0."
  Assert-Equal $switchJoinAck.Json.data.docId $switchDocId "Switch join_ack returned wrong docId."
  Assert-Equal $switchPresence.Json.code 0 "Switch presence should return code 0."

  Send-WsJson -Client $wsVerifier -Payload @{
    type = "set_cell"
    docId = $createdDocId
    clientId = $verifierClientId
    row = 9
    col = 9
    value = "should-fail-after-leave"
  }
  $afterLeaveSetCell = Receive-WsType -Client $wsVerifier -ExpectedType "error"
  Assert-Equal $afterLeaveSetCell.Json.code 4003 "set_cell after leaving old room should return error 4003."

  Send-WsJson -Client $wsVerifier -Payload @{
    type = "set_title"
    docId = $createdDocId
    clientId = $verifierClientId
    title = "should-fail-after-leave"
  }
  $afterLeaveSetTitle = Receive-WsType -Client $wsVerifier -ExpectedType "error"
  Assert-Equal $afterLeaveSetTitle.Json.code 4003 "set_title after leaving old room should return error 4003."

  Send-WsJson -Client $wsVerifier -Payload @{
    type = "undo"
    docId = $createdDocId
    clientId = $verifierClientId
  }
  $afterLeaveUndo = Receive-WsType -Client $wsVerifier -ExpectedType "error"
  Assert-Equal $afterLeaveUndo.Json.code 4003 "undo after leaving old room should return error 4003."

  Send-WsJson -Client $wsVerifier -Payload @{
    type = "redo"
    docId = $createdDocId
    clientId = $verifierClientId
  }
  $afterLeaveRedo = Receive-WsType -Client $wsVerifier -ExpectedType "error"
  Assert-Equal $afterLeaveRedo.Json.code 4003 "redo after leaving old room should return error 4003."
  Write-Host "PASS WS room switch => old room set_cell / set_title / undo / redo all forbidden" -ForegroundColor Green

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
  if ($null -ne $wsUnauthorized) {
    Close-WsClient -Client $wsUnauthorized
  }
  if ($null -ne $wsVerifier) {
    Close-WsClient -Client $wsVerifier
  }
  if ($null -ne $wsSecondary) {
    Close-WsClient -Client $wsSecondary
  }
  if ($null -ne $ws) {
    Close-WsClient -Client $ws
  }
}
