interface OpcoesScriptPhp {
  webhookUrl: string;
  token: string;
  secret: string;
  dbName: string;
}

export function gerarScriptPhpPorUsuario({ webhookUrl, token, secret, dbName }: OpcoesScriptPhp): string {
  return `<?php
// pdv-sync-locaweb-por-usuario.php
// Roda dentro do hosting Locaweb (mesma rede do MySQL do PDV), chamado periodicamente
// (cron ou similar). 1 credencial (token+secret) por franquia — a granularidade por
// operador vem do campo \`usuario\`, incluído em cada forma de pagamento e retirada,
// não de credenciais separadas por vendedor.

$MYSQL_HOST = 'localhost';
$MYSQL_DB   = '${dbName}';
$MYSQL_USER = 'SEU_USUARIO_MYSQL';
$MYSQL_PASS = 'SUA_SENHA_MYSQL'; // preencher

$WEBHOOK_URL = '${webhookUrl}';

$PDV_TOKEN  = '${token}';
$PDV_SECRET = '${secret}';

// Mapeamento de conta -> forma_pagamento (confirmado em produção, tabela \`conta\` do A7 Pharma).
$MAPA_CONTA_FORMA = [
    1  => 'dinheiro',
    8  => 'cartao_debito',
    9  => 'cartao_credito',
    10 => 'venda_internet',
    11 => 'deposito',
    12 => 'pix',
];

function conectarMysql($host, $db, $user, $pass) {
    $mysqli = new mysqli($host, $user, $pass, $db);
    if ($mysqli->connect_error) {
        throw new Exception('Falha ao conectar no MySQL: ' . $mysqli->connect_error);
    }
    return $mysqli;
}

function buscarFormasPagamentoPorUsuario($mysqli, $mapaContaForma) {
    // Uma query só, agrupada por usuário e conta — sem loop por vendedor.
    $result = $mysqli->query(
        "SELECT usuario, conta, COALESCE(SUM(valor), 0) AS total
         FROM movimento
         WHERE data = CURDATE() AND es = 'E'
         GROUP BY usuario, conta"
    );

    $formas = [];
    while ($row = $result->fetch_assoc()) {
        $conta = (int) $row['conta'];
        if (!isset($mapaContaForma[$conta])) continue;
        $formas[] = [
            'usuario' => $row['usuario'],
            'forma_pagamento' => $mapaContaForma[$conta],
            'valor' => round((float) $row['total'], 2),
        ];
    }
    return $formas;
}

function buscarRetiradas($mysqli) {
    // Sangria = saída (es='S') em dinheiro (conta=1), de qualquer usuário da loja.
    $result = $mysqli->query(
        "SELECT id, valor, historico, usuario, data_hora
         FROM movimento
         WHERE data = CURDATE() AND es = 'S' AND conta = 1"
    );

    $retiradas = [];
    while ($row = $result->fetch_assoc()) {
        $retiradas[] = [
            'origem_id' => (string) $row['id'],
            'valor'     => abs((float) $row['valor']),
            'motivo'    => $row['historico'] ?: 'Retirada (sangria)',
            'usuario'   => $row['usuario'],
            'criado_em' => $row['data_hora'] ? date('c', strtotime($row['data_hora'])) : null,
        ];
    }
    return $retiradas;
}

function assinarEEnviar($url, $token, $secret, array $payload) {
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $timestamp = (string) round(microtime(true) * 1000);
    $signature = hash_hmac('sha256', $timestamp . '.' . $body, $secret);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'x-pdv-token: ' . $token,
            'x-pdv-signature: ' . $signature,
            'x-pdv-timestamp: ' . $timestamp,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
    ]);
    $resposta = curl_exec($ch);
    $statusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $erro = curl_error($ch);
    curl_close($ch);

    return ['status' => $statusCode, 'resposta' => $resposta, 'erro' => $erro];
}

// --- Execução ---

$mysqli = conectarMysql($MYSQL_HOST, $MYSQL_DB, $MYSQL_USER, $MYSQL_PASS);
$hoje = date('Y-m-d');

$formas = buscarFormasPagamentoPorUsuario($mysqli, $MAPA_CONTA_FORMA);
$retiradas = buscarRetiradas($mysqli);

$payload = [
    'data' => $hoje,
    'formas' => $formas,
    'retiradas' => $retiradas,
];

$resultado = assinarEEnviar($WEBHOOK_URL, $PDV_TOKEN, $PDV_SECRET, $payload);

echo sprintf(
    "status=%s erro=%s resposta=%s\\n",
    $resultado['status'],
    $resultado['erro'] ?: '-',
    $resultado['resposta']
);

$mysqli->close();
`;
}
