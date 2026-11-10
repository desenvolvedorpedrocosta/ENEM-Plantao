/**
 * ENEM Plantão 2026 — Backend Google Apps Script
 * Apoio rápido às equipes de aplicação — Francisco Morato/SP
 *
 * IMPORTANTE:
 * 1) Troque o PIN administrativo antes de implantar.
 * 2) Gere chaves NOVAS no Google AI Studio (as chaves compartilhadas em conversa devem ser revogadas).
 * 3) Cadastre as novas chaves em CHAVES_GEMINI_INICIAIS e execute atualizarChavesGeminiPeloCodigo().
 * 4) As chaves ficam nas Script Properties; não as deixe no código após cadastrá-las.
 * 5) Chaves do mesmo projeto Google compartilham as cotas do projeto.
 * 6) O PIN escolar de 2 dígitos é uma barreira operacional, não autenticação forte.
 */

const CONFIG = Object.freeze({
  NOME_APP: 'ENEM Plantão 2026',
  MANUAL_FILE_ID: '1COyy-mdN22t4atD63HMWwaRTjxli2gbG',
  MANUAL_FILE_URL: 'https://drive.google.com/file/d/1COyy-mdN22t4atD63HMWwaRTjxli2gbG/view?usp=sharing',

  // Opcional: envie a logomarca (PNG transparente, JPG ou SVG) ao Google Drive e informe o ID.
  // O Apps Script incorporará a imagem na página para não depender de links blob temporários.
  LOGO_DRIVE_FILE_ID: '',

  // Altere para um PIN administrativo próprio, de preferência com 8 ou mais dígitos.
  ADMIN_PIN_INICIAL: '73918462',

  // Cole aqui até 3 CHAVES NOVAS de autorização do Google AI Studio.
  // Depois de executar atualizarChavesGeminiPeloCodigo(), apague os valores reais daqui.
  // Não reutilize as chaves que já foram compartilhadas em conversa.
  CHAVES_GEMINI_INICIAIS: [
    'COLE_A_NOVA_CHAVE_GEMINI_1_AQUI',
    'COLE_A_NOVA_CHAVE_GEMINI_2_AQUI',
    'COLE_A_NOVA_CHAVE_GEMINI_3_AQUI'
  ],

  // Modelo estável com suporte a PDF e faixa gratuita publicada na página de preços.
  MODELO_GEMINI: 'gemini-3.5-flash-lite',

  // Sessões: até 6 horas. A plataforma pode ser encerrada pelo Admin a qualquer momento.
  DURACAO_SESSAO_SEGUNDOS: 21600,
  DURACAO_SESSAO_ADMIN_SEGUNDOS: 14400,
  DURACAO_ARQUIVO_GEMINI_MS: 47 * 60 * 60 * 1000,
  TAMANHO_BLOCO_UPLOAD_BYTES: 8 * 1024 * 1024, // 8 MiB: alinhado à granularidade exigida pelo Gemini Files API.
  LIMITE_HISTORICO_ADMIN: 180,
  LIMITE_PERGUNTA_CARACTERES: 1800,
  MENSAGEM_ENCERRAMENTO: 'Este ciclo de atendimento da plataforma foi encerrado. Agradecemos às equipes de aplicação pelo compromisso e dedicação.\n\nCoordenação Local de Aplicação — Francisco Morato/SP'
});

const ESCOLAS = Object.freeze([
  { pin: '01', nome: 'E.E. Levorin' },
  { pin: '02', nome: 'ETEC Francisco Morato' },
  { pin: '03', nome: 'E.E. Parque 120' },
  { pin: '04', nome: 'E.E. Jardim Silvia' },
  { pin: '05', nome: 'E.E. Professor Ary Cabral de Bueno' },
  { pin: '06', nome: 'E.E. PPA - Plínio Salgado' },
  { pin: '07', nome: 'E.E. Afonso Vergueiro' },
  { pin: '08', nome: 'E.E. Aparecido Roberto Tonellotti' },
  { pin: '09', nome: 'E.E. Vila Camponesa' },
  { pin: '10', nome: 'E.E. Vincenzo Florio' },
  { pin: '11', nome: 'E.E. Lydia Horvath' },
  { pin: '12', nome: 'E.E. Celestina Forner' },
  { pin: '13', nome: 'E.E. Belem da Serra' },
  { pin: '14', nome: 'E.E. Profª Rosa Cazzares (Rosas)' },
  { pin: '15', nome: 'E.E. José de Barros Martins Editor' },
  { pin: '16', nome: 'E.E. Silvia Aparecida' },
  { pin: '17', nome: 'E.E. Jardim Alegria' },
  { pin: '18', nome: 'E.E. Ulysses Guimarães' }
]);

const PROP = Object.freeze({
  ADMIN_HASH: 'ADMIN_PIN_SHA256',
  API_KEYS: 'GEMINI_API_KEYS_JSON',
  ENABLED: 'PLATAFORMA_ATIVA',
  CLOSURE: 'MENSAGEM_ENCERRAMENTO',
  LOG_SHEET_ID: 'LOG_SPREADSHEET_ID'
});

const SYSTEM_PROMPT = [
  'Você é o ENEM Plantão 2026, assistente de consulta operacional para coordenadores e assistentes de local de aplicação do ENEM em Francisco Morato/SP.',
  'Sua única fonte normativa nesta consulta é o PDF anexado: Manual do Coordenador do ENEM 2026.',
  'Priorize o SEGUNDO DIA de aplicação: horários, fechamento dos portões, início e término, cadernos de questões, cartões-resposta, folha de rascunho, procedimentos em sala, saídas, eliminações, malotes, materiais, ocorrências e atribuições da equipe. Também responda regras gerais e do primeiro dia quando perguntado.',
  'Responda em português do Brasil, com linguagem muito simples, direta, humana e operacional. Comece pela orientação prática. Use passos curtos quando houver procedimento. Diferencie claramente o que o coordenador faz, o que o assistente faz e o que cabe ao chefe de sala, somente quando o manual permitir essa distinção.',
  'REGRA ABSOLUTA DE FONTE: não use memória, conhecimento externo, regras de anos anteriores, suposições ou práticas habituais para completar lacunas. Não invente horários, tolerâncias, exceções, formulários, procedimentos, atribuições ou páginas.',
  'CITAÇÃO OBRIGATÓRIA: toda resposta operacional deve indicar o número da página física do PDF (contagem do visualizador, começando em 1) em que a informação aparece. Se o manual também exibir numeração impressa, informe-a separadamente. Não confunda o número impresso com a posição da página no PDF.',
  'A página citada deve realmente sustentar a orientação. Inclua em trecho_comprovacao uma citação curta e literal do trecho que dá suporte à resposta. Não invente citação textual.',
  'Se a pergunta não puder ser respondida claramente pelo PDF, retorne encontrado=false, paginas_pdf=[], resposta explicando que não localizou regra suficiente e orientando a consultar o coordenador responsável/coordenação competente. Não tente adivinhar uma página.',
  'Se houver conflito, ambiguidade, trecho ilegível ou ausência de informação, diga isso explicitamente. Não transforme uma recomendação em regra oficial.',
  'Não solicite nem reproduza dados pessoais de candidatos. Oriente o usuário a não inserir nomes, CPF, inscrição, dados médicos ou outros dados identificáveis.',
  'A resposta deve ser breve e útil em situação de urgência. Quando a informação depender do momento da aplicação, destaque que a equipe deve seguir a orientação oficial vigente da coordenação e o manual.',
  'Retorne EXCLUSIVAMENTE um objeto JSON compatível com o esquema solicitado, sem Markdown, sem cercas de código e sem texto fora do JSON.'
].join('\n');

function doGet(e) {
  // API JSONP para o front-end estático no GitHub Pages. JSONP evita CORS
  // entre github.io e o domínio googleusercontent do Web App.
  const params = (e && e.parameter) || {};
  if (params.api) return responderApiJsonp_(params);

  // Mantém a página HTML do Apps Script disponível para testes/compatibilidade.
  const template = HtmlService.createTemplateFromFile('Index');
  template.logoDataUri = obterLogoDataUri_();
  return template.evaluate()
    .setTitle(CONFIG.NOME_APP + ' | Francisco Morato')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

function responderApiJsonp_(params) {
  const callback = String(params.callback || '');
  if (!/^[A-Za-z_$][0-9A-Za-z_$\.]{0,100}$/.test(callback)) {
    return ContentService.createTextOutput('/* callback inválido */').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  let result;
  try {
    const args = JSON.parse(params.args || '[]');
    if (!Array.isArray(args)) throw new Error('Parâmetros inválidos.');
    const routes = {
      apiObterEstado: apiObterEstado,
      apiLoginEscola: apiLoginEscola,
      apiValidarSessao: apiValidarSessao,
      apiHeartbeat: apiHeartbeat,
      apiLogout: apiLogout,
      apiLogoutAdministrador: apiLogoutAdministrador,
      apiLoginAdministrador: apiLoginAdministrador,
      apiAdminPainel: apiAdminPainel,
      apiAdminDefinirPlataforma: apiAdminDefinirPlataforma,
      apiPerguntar: apiPerguntar,
      apiApagarHistoricoEscola: apiApagarHistoricoEscola
    };
    const fn = routes[String(params.api)];
    if (!fn) throw new Error('Operação não autorizada.');
    result = fn.apply(null, args);
  } catch (err) {
    result = { ok: false, mensagem: mensagemErroSegura_(err), erroServidor: true };
  }
  const json = JSON.stringify(result === undefined ? { ok: true } : result)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return ContentService.createTextOutput(callback + '(' + json + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/**
 * Exibe no registro de execução o endereço oficial da implantação publicada.
 * Compartilhe somente o endereço terminado em /exec (nunca /dev ou link do Drive).
 * A função informa a URL, mas não consegue consultar nem alterar permissões da implantação.
 */
function mostrarUrlOficialWebApp() {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error('Nenhum endereço de Aplicativo da Web foi encontrado. Faça uma implantação em Implantar > Nova implantação > Aplicativo da Web.');
  }
  const urlLimpa = String(url).split('?')[0];
  if (!/\/exec$/.test(urlLimpa)) {
    console.warn('O endereço retornado não termina em /exec: ' + urlLimpa);
  }
  Logger.log('URL oficial do ENEM Plantão: ' + urlLimpa);
  Logger.log('Compartilhe esse endereço /exec. Não compartilhe URL do Drive nem endereço /dev.');
  return urlLimpa;
}

/** Incorpora a logomarca no HTML. Endereços blob: não são persistentes nem acessíveis pelo Apps Script. */
function obterLogoDataUri_() {
  const id = String(CONFIG.LOGO_DRIVE_FILE_ID || '').trim();
  if (!id) return '';
  try {
    const file = DriveApp.getFileById(id);
    const blob = file.getBlob();
    const mime = String(blob.getContentType() || file.getMimeType() || '').toLowerCase();
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(mime)) return '';
    const bytes = blob.getBytes();
    if (bytes.length > 800 * 1024) {
      console.warn('Logomarca ignorada: arquivo maior que 800 KB. Use PNG/SVG otimizado.');
      return '';
    }
    const normalizedMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
    return 'data:' + normalizedMime + ';base64,' + Utilities.base64Encode(bytes);
  } catch (err) {
    console.error('Não foi possível carregar a logomarca do Drive: ' + err);
    return '';
  }
}

/** Execute manualmente uma vez no editor após editar o PIN e as chaves acima. */
function configurarSistemaInicial() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP.ADMIN_HASH)) {
    if (!CONFIG.ADMIN_PIN_INICIAL || CONFIG.ADMIN_PIN_INICIAL.length < 8) {
      throw new Error('Defina ADMIN_PIN_INICIAL com pelo menos 8 caracteres antes de configurar.');
    }
    props.setProperty(PROP.ADMIN_HASH, hashTexto_(CONFIG.ADMIN_PIN_INICIAL));
  }

  const cadastradas = CONFIG.CHAVES_GEMINI_INICIAIS.map(function (k) { return String(k || '').trim(); }).filter(function (k) {
    return k.length >= 25 && !/^COLE_/i.test(k) && !/^SUA_CHAVE/i.test(k);
  });
  if (!props.getProperty(PROP.API_KEYS) && cadastradas.length) {
    props.setProperty(PROP.API_KEYS, JSON.stringify(cadastradas.slice(0, 3)));
  }

  if (props.getProperty(PROP.ENABLED) === null) props.setProperty(PROP.ENABLED, 'true');
  if (!props.getProperty(PROP.CLOSURE)) props.setProperty(PROP.CLOSURE, CONFIG.MENSAGEM_ENCERRAMENTO);

  // Cria o arquivo privado de auditoria durante a instalação para antecipar a autorização do Sheets.
  obterAbaLogs_();

  return {
    ok: true,
    mensagem: 'Configuração inicial concluída.',
    chavesRegistradas: lerChavesGemini_().length,
    observacao: 'As chaves ficam nas Propriedades do script. Remova as chaves reais do código depois desta configuração.'
  };
}

/** Use somente se quiser redefinir o PIN administrativo a partir do valor no CONFIG. */
function redefinirPINAdministradorPeloCodigo() {
  if (!CONFIG.ADMIN_PIN_INICIAL || CONFIG.ADMIN_PIN_INICIAL.length < 8) {
    throw new Error('O PIN administrativo precisa ter pelo menos 8 caracteres.');
  }
  PropertiesService.getScriptProperties().setProperty(PROP.ADMIN_HASH, hashTexto_(CONFIG.ADMIN_PIN_INICIAL));
  return 'PIN administrativo redefinido.';
}

/**
 * Grava até três chaves Gemini nas Propriedades do script.
 * IMPORTANTE: primeiro cole chaves NOVAS em CONFIG.CHAVES_GEMINI_INICIAIS.
 * Depois execute esta função pelo editor do Apps Script.
 */
function atualizarChavesGeminiPeloCodigo() {
  const fonte = Array.isArray(CONFIG.CHAVES_GEMINI_INICIAIS) ? CONFIG.CHAVES_GEMINI_INICIAIS : [];
  const keys = fonte.map(function (k) { return String(k || '').trim(); })
    .filter(function (k) {
      return k.length >= 25 && !/^COLE_/i.test(k) && !/^SUA_CHAVE/i.test(k);
    })
    .slice(0, 3);

  if (!keys.length) {
    throw new Error(
      'Nenhuma chave foi cadastrada. No início do Code.gs, substitua os três textos COLE_A_NOVA_CHAVE_GEMINI por chaves NOVAS do Google AI Studio, salve o projeto e execute novamente atualizarChavesGeminiPeloCodigo().'
    );
  }

  PropertiesService.getScriptProperties().setProperty(PROP.API_KEYS, JSON.stringify(keys));
  return 'Sucesso: ' + keys.length + ' chave(s) Gemini gravada(s) nas Propriedades do script. Agora remova as chaves do array no Code.gs, salve e execute testarConexaoGemini().';
}

/**
 * Envia o PDF ao Files API antes do evento.
 * A transferência é feita em blocos alinhados à granularidade informada pelo Gemini (mínimo observado: 8 MiB).
 */
function prepararManualNoGemini() {
  const keys = lerChavesGemini_();
  if (!keys.length) throw new Error('Configure pelo menos uma chave Gemini antes de preparar o Manual.');

  const file = DriveApp.getFileById(CONFIG.MANUAL_FILE_ID);
  const tamanho = file.getSize();
  if (tamanho <= 0) throw new Error('O arquivo do Manual está vazio ou não foi possível identificar seu tamanho.');
  if (tamanho > 50 * 1024 * 1024) {
    throw new Error('O Manual possui ' + formatarTamanhoMB_(tamanho) + ' MB. O Gemini Files API aceita PDF de até 50 MB. Comprima o PDF ou utilize uma cópia otimizada.');
  }

  const props = PropertiesService.getScriptProperties();
  let ultimoErro = '';
  for (let i = 0; i < keys.length; i++) {
    try {
      const uri = garantirPDFNoGemini_(keys[i]);
      // Registra a credencial que preparou o arquivo para que as perguntas reutilizem o mesmo cache.
      props.setProperty('GEMINI_ULTIMA_CHAVE_OK', String(i));
      const cacheProp = 'GEMINI_PDF_' + hashTexto_(keys[i]).substring(0, 18);
      const cacheData = JSON.parse(props.getProperty(cacheProp) || '{}');
      return {
        ok: true,
        mensagem: 'O Manual foi enviado em blocos e está preparado para consultas.',
        modelo: CONFIG.MODELO_GEMINI,
        chaveUtilizada: i + 1,
        tamanhoMB: formatarTamanhoMB_(tamanho),
        tamanhoBytesDrive: tamanho,
        tamanhoBytesGemini: Number(cacheData.sizeBytes || 0),
        integridadeBytesConfirmada: Number(cacheData.sizeBytes || 0) === tamanho,
        tipoGemini: cacheData.mimeType || '',
        tamanhoBlocoMiB: 8,
        validadeCacheAproximadaHoras: Math.floor(CONFIG.DURACAO_ARQUIVO_GEMINI_MS / (60 * 60 * 1000)),
        arquivoGemini: uri,
        observacao: 'O PDF foi transferido em blocos de 8 MiB (ou na granularidade informada pelo servidor Gemini) para respeitar o protocolo de upload. O arquivo temporário do Gemini expira em até 48 horas.'
      };
    } catch (err) {
      ultimoErro = mensagemErroSegura_(err);
      // Não repetir erros de memória, transferência, tamanho, Drive ou cota usando outras chaves.
      if (/MEMORIA|memória|UPLOAD_EM_ANDAMENTO|HTTP 400|HTTP 404|HTTP 429|quota|rate.?limit|resource.?exhausted|Drive|Range|bloco|50 MB/i.test(String((err && err.message) || err))) break;
      // Só faz sentido tentar outra chave quando a falha aparenta ser autenticação/permissão da chave.
      if (!/401|403|API.?key|credencial|autorização|permission/i.test(String((err && err.message) || err))) break;
    }
  }
  throw new Error('Não foi possível preparar o Manual. ' + (ultimoErro || 'Verifique o acesso ao PDF e a configuração da API Gemini.'));
}

/** Testa a chave e a autorização UrlFetch sem enviar perguntas nem consumir tokens de geração. */
function testarConexaoGemini() {
  const keys = lerChavesGemini_();
  if (!keys.length) throw new Error('Nenhuma chave Gemini configurada.');
  const resultados = keys.map(function (key, index) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models';
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'x-goog-api-key': key },
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        return { numero: index + 1, valida: false, http: code, mensagem: extrairErroGemini_(response.getContentText()) };
      }
      const obj = JSON.parse(response.getContentText());
      const found = (obj.models || []).some(function (m) { return String(m.name || '').indexOf(CONFIG.MODELO_GEMINI) >= 0; });
      return { numero: index + 1, valida: true, modeloListado: found };
    } catch (e) {
      return { numero: index + 1, valida: false, mensagem: mensagemErroSegura_(e) };
    }
  });
  const validas = resultados.filter(function (r) { return r.valida; }).length;
  if (!validas) throw new Error('Nenhuma das ' + keys.length + ' chaves conseguiu acessar a Gemini API. Resultado: ' + JSON.stringify(resultados));
  return { ok: true, chavesTestadas: keys.length, chavesValidas: validas, resultados: resultados, modelo: CONFIG.MODELO_GEMINI };
}

/** Diagnóstico manual: testa acesso ao PDF no Drive sem chamar a IA nem consumir tokens. */
function diagnosticoInicial() {
  const file = DriveApp.getFileById(CONFIG.MANUAL_FILE_ID);
  const tamanho = file.getSize();
  return {
    arquivo: file.getName(),
    mimeType: file.getMimeType(),
    tamanhoMB: formatarTamanhoMB_(tamanho),
    tamanhoBytes: tamanho,
    ultimaAtualizacao: formatarData_(file.getLastUpdated()),
    chavesConfiguradas: lerChavesGemini_().length,
    modelo: CONFIG.MODELO_GEMINI,
    tipoEsperado: 'application/pdf'
  };
}

/** Teste rápido do recurso HTTP Range: baixa apenas os primeiros 64 KB do PDF. */
function testarDownloadParcialManual() {
  const file = DriveApp.getFileById(CONFIG.MANUAL_FILE_ID);
  const tamanho = file.getSize();
  if (tamanho <= 0) throw new Error('O arquivo do Manual está vazio.');
  const fim = Math.min(65535, tamanho - 1);
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.getId()) + '?alt=media&supportsAllDrives=true';
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
      'Range': 'bytes=0-' + fim
    },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code !== 206) {
    throw new Error('O Drive não confirmou download parcial (HTTP ' + code + '). Não execute o envio ao Gemini até corrigir o acesso Range.');
  }
  const bytes = response.getContent();
  const contentRange = obterCabecalhoHttp_(response.getAllHeaders(), 'content-range');
  if (!bytes || bytes.length !== fim + 1) throw new Error('O teste Range retornou um bloco incompleto.');
  if (!contentRange || !new RegExp('^bytes\\s+0-' + fim + '/' + tamanho + '$', 'i').test(contentRange.trim())) {
    throw new Error('O Drive não confirmou o Content-Range do primeiro trecho do PDF.');
  }
  const header = Utilities.newBlob(bytes.slice(0, Math.min(bytes.length, 5))).getDataAsString();
  if (header.indexOf('%PDF-') !== 0) throw new Error('O arquivo no Drive não começa com a assinatura esperada de um PDF (%PDF-).');
  return {
    ok: true,
    arquivo: file.getName(),
    mimeType: file.getMimeType(),
    tamanhoTotalBytes: tamanho,
    http: code,
    bytesRecebidos: bytes.length,
    contentRange: contentRange,
    assinaturaPDF: header,
    mensagem: 'Primeiro intervalo do PDF confirmado (HTTP 206). O arquivo completo ainda será validado pelo tamanho retornado pelo Gemini após o upload.'
  };
}

function apiObterEstado() {
  const props = PropertiesService.getScriptProperties();
  const enabled = props.getProperty(PROP.ENABLED) !== 'false';
  return {
    nomeApp: CONFIG.NOME_APP,
    enabled: enabled,
    mensagemEncerramento: props.getProperty(PROP.CLOSURE) || CONFIG.MENSAGEM_ENCERRAMENTO,
    escolas: ESCOLAS
  };
}

function apiLoginEscola(pinEscola, pinDigitado) {
  const status = apiObterEstado();
  if (!status.enabled) return { ok: false, encerrada: true, mensagem: status.mensagemEncerramento };

  const pin = String(pinEscola || '').trim();
  const digitado = String(pinDigitado || '').trim();
  const escola = ESCOLAS.find(function (e) { return e.pin === pin; });
  if (!escola || !/^\d{2}$/.test(digitado) || digitado !== pin) {
    registrarLog_('—', 'LOGIN_NEGADO', '', 'Tentativa de acesso com PIN inválido.', '', 'NEGADO');
    return { ok: false, mensagem: 'Escola ou PIN incorreto. Confira os dois dígitos e tente novamente.' };
  }

  const token = novoToken_();
  const sessao = { tipo: 'ESCOLA', escolaPin: escola.pin, escolaNome: escola.nome, criadaEm: Date.now() };
  CacheService.getScriptCache().put('SESSAO_' + token, JSON.stringify(sessao), CONFIG.DURACAO_SESSAO_SEGUNDOS);
  tocarEscolaAtiva_(escola.pin);
  registrarLog_(escola.nome, 'LOGIN', '', 'Acesso liberado.', '', 'OK');
  return { ok: true, token: token, escola: escola.nome, pin: escola.pin, expiraEm: CONFIG.DURACAO_SESSAO_SEGUNDOS };
}

function apiValidarSessao(token) {
  const sessao = obterSessao_(token, 'ESCOLA');
  if (!sessao) return { ok: false, mensagem: 'Sua sessão expirou. Entre novamente.' };
  const status = apiObterEstado();
  if (!status.enabled) return { ok: false, encerrada: true, mensagem: status.mensagemEncerramento };
  tocarEscolaAtiva_(sessao.escolaPin);
  return { ok: true, escola: sessao.escolaNome, pin: sessao.escolaPin };
}

function apiHeartbeat(token) {
  const sessao = obterSessao_(token, 'ESCOLA');
  if (!sessao) return { ok: false, mensagem: 'Sessão expirada.' };
  const status = apiObterEstado();
  if (!status.enabled) return { ok: false, encerrada: true, mensagem: status.mensagemEncerramento };
  tocarEscolaAtiva_(sessao.escolaPin);
  return { ok: true };
}

function apiLogout(token) {
  if (token) CacheService.getScriptCache().remove('SESSAO_' + String(token));
  return { ok: true };
}

/** Apaga do banco privado somente as consultas da escola autenticada. */
function apiApagarHistoricoEscola(token) {
  const sessao = obterSessao_(token, 'ESCOLA');
  if (!sessao) return { ok: false, sessaoExpirada: true, mensagem: 'Sua sessão expirou. Entre novamente.' };
  const status = apiObterEstado();
  if (!status.enabled) return { ok: false, encerrada: true, mensagem: status.mensagemEncerramento };
  const lock = LockService.getScriptLock();
  let removidos = 0;
  lock.waitLock(15000);
  try {
    const sh = obterAbaLogs_();
    const last = sh.getLastRow();
    if (last >= 2) {
      const rows = sh.getRange(2, 1, last - 1, 8).getValues();
      const deletar = [];
      rows.forEach(function (r, i) {
        const pin = String(r[2] || '');
        const acao = String(r[3] || '');
        if (pin === sessao.escolaPin && /^PERGUNTA_(OK|SEM_FONTE|ERRO)$/.test(acao)) deletar.push(i + 2);
      });
      for (let i = deletar.length - 1; i >= 0; i--) { sh.deleteRow(deletar[i]); removidos++; }
    }
    PropertiesService.getScriptProperties().setProperty('PERGUNTAS_' + sessao.escolaPin, '0');
  } finally {
    lock.releaseLock();
  }
  // Registra a ação somente depois de liberar o lock para evitar bloqueio reentrante.
  registrarLog_(sessao.escolaNome, 'HISTORICO_APAGADO', '', 'Registros de consulta removidos: ' + removidos + '.', '', 'OK');
  return { ok: true, removidos: removidos, mensagem: 'Histórico apagado do dispositivo e dos registros de consultas desta escola.' };
}

function apiLogoutAdministrador(token) {
  if (token) CacheService.getScriptCache().remove('ADMIN_' + String(token));
  return { ok: true };
}

function apiLoginAdministrador(pin) {
  const props = PropertiesService.getScriptProperties();
  const esperado = props.getProperty(PROP.ADMIN_HASH);
  if (!esperado) return { ok: false, mensagem: 'Administração ainda não configurada. Execute configurarSistemaInicial() no editor.' };
  if (!comparacaoSegura_(hashTexto_(String(pin || '')), esperado)) {
    registrarLog_('ADMIN', 'LOGIN_ADMIN_NEGADO', '', 'Tentativa de acesso administrativo negada.', '', 'NEGADO');
    return { ok: false, mensagem: 'PIN administrativo incorreto.' };
  }
  const token = novoToken_();
  CacheService.getScriptCache().put('ADMIN_' + token, JSON.stringify({ tipo: 'ADMIN', criadaEm: Date.now() }), CONFIG.DURACAO_SESSAO_ADMIN_SEGUNDOS);
  registrarLog_('ADMIN', 'LOGIN_ADMIN', '', 'Acesso administrativo liberado.', '', 'OK');
  return { ok: true, token: token };
}

function apiAdminPainel(token) {
  if (!obterSessao_(token, 'ADMIN')) return { ok: false, mensagem: 'Sessão administrativa expirada.' };

  const stats = {};
  ESCOLAS.forEach(function (e) {
    const activeAt = Number(CacheService.getScriptCache().get('ATIVA_' + e.pin) || 0);
    stats[e.pin] = {
      pin: e.pin,
      escola: e.nome,
      ativa: activeAt > 0 && (Date.now() - activeAt) < 130000,
      ultimoSinal: activeAt ? formatarData_(new Date(activeAt)) : '—',
      perguntas: 0,
      ultimoAcesso: '—'
    };
  });

  const dados = lerLogs_(5000);
  dados.forEach(function (r) {
    const pin = String(r[2] || '');
    const action = String(r[3] || '');
    if (stats[pin]) {
      if (action === 'PERGUNTA_OK' || action === 'PERGUNTA_SEM_FONTE' || action === 'PERGUNTA_ERRO') stats[pin].perguntas++;
      if (r[0]) stats[pin].ultimoAcesso = formatarData_(new Date(r[0]));
    }
  });

  const recent = dados.slice(-CONFIG.LIMITE_HISTORICO_ADMIN).reverse().map(function (r) {
    return {
      data: r[0] ? formatarData_(new Date(r[0])) : '—',
      escola: String(r[1] || '—'),
      pin: String(r[2] || '—'),
      acao: String(r[3] || '—'),
      pergunta: String(r[4] || ''),
      resposta: String(r[5] || ''),
      modelo: String(r[6] || ''),
      resultado: String(r[7] || '')
    };
  });

  const props = PropertiesService.getScriptProperties();
  Object.keys(stats).forEach(function (pin) {
    stats[pin].perguntas = Number(props.getProperty('PERGUNTAS_' + pin) || 0);
  });
  const perguntasTotal = Object.keys(stats).reduce(function (sum, pin) { return sum + stats[pin].perguntas; }, 0);
  const acessosAtivos = Object.keys(stats).filter(function (pin) { return stats[pin].ativa; }).length;
  return {
    ok: true,
    enabled: props.getProperty(PROP.ENABLED) !== 'false',
    mensagemEncerramento: props.getProperty(PROP.CLOSURE) || CONFIG.MENSAGEM_ENCERRAMENTO,
    escolas: Object.keys(stats).map(function (pin) { return stats[pin]; }),
    totalPerguntas: perguntasTotal,
    escolasAtivas: acessosAtivos,
    logs: recent,
    atualizadoEm: formatarData_(new Date())
  };
}

function apiAdminDefinirPlataforma(token, enabled, mensagem) {
  if (!obterSessao_(token, 'ADMIN')) return { ok: false, mensagem: 'Sessão administrativa expirada.' };
  const ativa = enabled === true || String(enabled) === 'true';
  const texto = String(mensagem || CONFIG.MENSAGEM_ENCERRAMENTO).trim().slice(0, 800);
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PROP.ENABLED, ativa ? 'true' : 'false');
  props.setProperty(PROP.CLOSURE, texto || CONFIG.MENSAGEM_ENCERRAMENTO);
  registrarLog_('ADMIN', ativa ? 'PLATAFORMA_ATIVADA' : 'PLATAFORMA_ENCERRADA', '', ativa ? 'Plataforma reativada.' : 'Plataforma encerrada.', '', 'OK');
  return { ok: true, enabled: ativa, mensagem: texto };
}

function apiPerguntar(token, pergunta) {
  let sessao = null;
  let texto = '';
  try {
    sessao = obterSessao_(token, 'ESCOLA');
    if (!sessao) return { ok: false, sessaoExpirada: true, mensagem: 'Sua sessão expirou. Entre novamente.' };

    const status = apiObterEstado();
    if (!status.enabled) return { ok: false, encerrada: true, mensagem: status.mensagemEncerramento };

    texto = String(pergunta || '').trim();
    if (!texto) return { ok: false, mensagem: 'Digite ou dite sua dúvida.' };
    if (texto.length > CONFIG.LIMITE_PERGUNTA_CARACTERES) {
      return { ok: false, mensagem: 'A pergunta ultrapassou o limite de ' + CONFIG.LIMITE_PERGUNTA_CARACTERES + ' caracteres. Resuma a dúvida.' };
    }

    tocarEscolaAtiva_(sessao.escolaPin);
    const result = consultarGeminiComManual_(texto);
    const resposta = result.dados;
    const pages = Array.isArray(resposta.paginas_pdf) ? resposta.paginas_pdf.filter(function (p) { return Number.isInteger(p) && p > 0; }) : [];
    const found = resposta.encontrado === true && pages.length > 0 && String(resposta.trecho_comprovacao || '').trim().length > 0 && String(resposta.resposta || '').trim().length > 0;
    const answerText = found
      ? String(resposta.resposta || '').trim()
      : (String(resposta.resposta || '').trim() || 'Não localizei no manual uma orientação suficientemente clara para responder com segurança. Consulte o coordenador responsável.');

    incrementarContagemPergunta_(sessao.escolaPin);
    registrarLog_(sessao.escolaNome, found ? 'PERGUNTA_OK' : 'PERGUNTA_SEM_FONTE', texto, answerText, result.modelo, found ? 'COM_PAGINA' : 'SEM_PAGINA');
    return {
      ok: true,
      encontrado: found,
      resposta: answerText,
      paginasPdf: found ? pages : [],
      paginaImpressa: found ? String(resposta.pagina_impressa || '').trim() : '',
      comprovacao: found ? String(resposta.trecho_comprovacao || '').trim() : '',
      observacao: String(resposta.observacao || '').trim(),
      modelo: result.modelo,
      escola: sessao.escolaNome,
      data: formatarData_(new Date())
    };
  } catch (err) {
    const msg = mensagemErroSegura_(err);
    console.error('apiPerguntar: ' + (err && err.stack ? err.stack : err));
    if (sessao) {
      incrementarContagemPergunta_(sessao.escolaPin);
      registrarLog_(sessao.escolaNome, 'PERGUNTA_ERRO', texto, msg, CONFIG.MODELO_GEMINI, 'ERRO');
    }
    // Sempre retorna objeto simples e serializável ao google.script.run.
    return { ok: false, codigo: 'CONSULTA_FALHOU', mensagem: msg };
  }
}

function consultarGeminiComManual_(pergunta) {
  const keys = lerChavesGemini_();
  if (!keys.length) throw new Error('Nenhuma chave Gemini está cadastrada nas Propriedades do script. Cadastre chaves novas e execute atualizarChavesGeminiPeloCodigo().');

  const props = PropertiesService.getScriptProperties();
  const lastOk = Number(props.getProperty('GEMINI_ULTIMA_CHAVE_OK'));
  const ordem = [];
  if (Number.isInteger(lastOk) && lastOk >= 0 && lastOk < keys.length) ordem.push(lastOk);
  for (let i = 0; i < keys.length; i++) if (ordem.indexOf(i) === -1) ordem.push(i);

  let ultimoErro = '';
  for (let tentativa = 0; tentativa < ordem.length; tentativa++) {
    const index = ordem[tentativa];
    const key = keys[index];
    try {
      const fileUri = garantirPDFNoGemini_(key);
      const payload = montarPayloadGemini_(pergunta, fileUri);
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.MODELO_GEMINI + ':generateContent';
      const response = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      const body = response.getContentText();

      if (code >= 200 && code < 300) {
        const parsed = JSON.parse(body);
        const candidate = (((parsed || {}).candidates || [])[0] || {});
        const parts = candidate.content;
        const texts = (parts && parts.parts ? parts.parts : []).map(function (part) { return part.text || ''; }).join('\n').trim();
        if (!texts) {
          const blockReason = candidate.finishReason || (parsed.promptFeedback && parsed.promptFeedback.blockReason) || '';
          throw new Error('O Gemini não retornou texto. ' + (blockReason ? 'Motivo informado: ' + blockReason + '.' : 'Tente reformular a pergunta.'));
        }
        const dados = interpretarJSONGemini_(texts);
        props.setProperty('GEMINI_ULTIMA_CHAVE_OK', String(index));
        return { dados: dados, modelo: CONFIG.MODELO_GEMINI, chaveUtilizada: index + 1 };
      }

      ultimoErro = 'HTTP ' + code + ': ' + extrairErroGemini_(body);
      // 429 é cota do projeto: não desperdiçar tempo repetindo a mesma chamada com outras chaves.
      if (code === 429) break;
      // 400/404 geralmente indicam payload ou modelo incorreto; repetir com outra chave não corrige.
      if (code === 400 || code === 404) break;
      // Alterna credencial quando a chave é recusada; em 5xx tenta a próxima como contingência.
      if (code === 401 || code === 403 || code === 408 || code >= 500) continue;
      break;
    } catch (err) {
      ultimoErro = mensagemErroSegura_(err);
      // Falhas de cota, arquivo/Drive ou configuração não melhoram ao repetir com outra chave.
      if (/429|quota|rate.?limit|resource.?exhausted|drive|permission|file not found|HTTP 400|HTTP 404|modelo|UPLOAD_EM_ANDAMENTO|memória|memory|out of memory|Range|bloco/i.test(String((err && err.message) || err))) break;
      if (tentativa < ordem.length - 1) continue;
    }
  }
  throw new Error('Consulta ao Gemini não concluída. ' + (ultimoErro || 'Verifique a conexão, a chave e a disponibilidade do modelo.'));
}

function montarPayloadGemini_(pergunta, fileUri) {
  const schema = {
    type: 'OBJECT',
    properties: {
      encontrado: { type: 'BOOLEAN' },
      resposta: { type: 'STRING' },
      paginas_pdf: { type: 'ARRAY', items: { type: 'INTEGER' } },
      pagina_impressa: { type: 'STRING' },
      trecho_comprovacao: { type: 'STRING' },
      observacao: { type: 'STRING' }
    },
    required: ['encontrado', 'resposta', 'paginas_pdf', 'pagina_impressa', 'trecho_comprovacao', 'observacao']
  };
  return {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        { text: 'Consulte o Manual do Coordenador do ENEM 2026 anexado. Prioridade operacional: segundo dia.\n\nPERGUNTA DA EQUIPE:\n' + pergunta + '\n\nInforme a página física do PDF (1 = primeira página do arquivo), não apenas a página impressa.' },
        { fileData: { mimeType: 'application/pdf', fileUri: fileUri } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      maxOutputTokens: 1400,
      responseMimeType: 'application/json',
      responseSchema: schema
    }
  };
}

function interpretarJSONGemini_(text) {
  let raw = String(text || '').trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A resposta do Gemini não veio no formato esperado. Tente reformular a pergunta.');
  const obj = JSON.parse(raw.substring(start, end + 1));
  return {
    encontrado: obj.encontrado === true,
    resposta: String(obj.resposta || ''),
    paginas_pdf: Array.isArray(obj.paginas_pdf) ? obj.paginas_pdf.map(Number).filter(function (n) { return Number.isInteger(n) && n > 0; }) : [],
    pagina_impressa: String(obj.pagina_impressa || ''),
    trecho_comprovacao: String(obj.trecho_comprovacao || ''),
    observacao: String(obj.observacao || '')
  };
}

/**
 * Reutiliza o PDF já preparado para esta chave; quando necessário, transfere em blocos.
 * O cache separado por chave evita tentar usar um fileUri criado em outro projeto Google.
 */
function garantirPDFNoGemini_(apiKey) {
  const file = DriveApp.getFileById(CONFIG.MANUAL_FILE_ID);
  const mime = file.getMimeType();
  if (mime !== MimeType.PDF && mime !== 'application/pdf') {
    throw new Error('O arquivo informado no Drive não é um PDF. Verifique o ID do Manual do Coordenador.');
  }

  const tamanho = file.getSize();
  if (tamanho <= 0) throw new Error('O PDF do Manual está vazio ou não possui tamanho identificável.');
  if (tamanho > 50 * 1024 * 1024) {
    throw new Error('O Manual possui ' + formatarTamanhoMB_(tamanho) + ' MB e ultrapassa o limite de 50 MB do Gemini Files API. Comprima o PDF antes de continuar.');
  }

  const modified = file.getLastUpdated().getTime();
  const keyTag = hashTexto_(apiKey).substring(0, 18);
  const cacheProp = 'GEMINI_PDF_' + keyTag;
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty(cacheProp);
  if (saved) {
    try {
      const obj = JSON.parse(saved);
      if (obj.uri && obj.name && obj.sizeBytes && obj.mimeType === 'application/pdf' && obj.modified === modified && (Date.now() - obj.uploadedAt) < CONFIG.DURACAO_ARQUIVO_GEMINI_MS) return obj.uri;
    } catch (e) { /* cache inválido: refaz o upload em blocos */ }
  }

  // Impede que acessos simultâneos tentem transferir o mesmo PDF várias vezes.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    throw new Error('UPLOAD_EM_ANDAMENTO: o Manual está sendo preparado em outra execução. Aguarde a conclusão e tente novamente.');
  }
  try {
    // Reconfere após obter o lock: outra execução pode ter concluído o envio.
    const savedAgain = props.getProperty(cacheProp);
    if (savedAgain) {
      try {
        const objAgain = JSON.parse(savedAgain);
        if (objAgain.uri && objAgain.name && objAgain.sizeBytes && objAgain.mimeType === 'application/pdf' && objAgain.modified === modified && (Date.now() - objAgain.uploadedAt) < CONFIG.DURACAO_ARQUIVO_GEMINI_MS) return objAgain.uri;
      } catch (e) { /* continua e envia novamente */ }
    }

    const uploaded = enviarPDFParaFilesAPI_(apiKey, file.getId(), file.getName(), tamanho);
    props.setProperty(cacheProp, JSON.stringify({
      uri: uploaded.uri,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      sizeBytes: String(uploaded.sizeBytes || ''),
      sha256Hash: uploaded.sha256Hash || '',
      modified: modified,
      uploadedAt: Date.now(),
      size: tamanho
    }));
    return uploaded.uri;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Faz upload resumível do PDF por blocos, sem chamar getBlob().getBytes() no arquivo inteiro.
 * O Drive fornece cada intervalo por HTTP Range e o Gemini recebe os mesmos bytes em série.
 */
function enviarPDFParaFilesAPI_(apiKey, fileId, fileName, fileSize) {
  const total = Number(fileSize);
  const startUrl = 'https://generativelanguage.googleapis.com/upload/v1beta/files';

  const start = UrlFetchApp.fetch(startUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(total),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf'
    },
    payload: JSON.stringify({ file: { display_name: 'ENEM_Manual_2026_' + String(fileName || 'manual.pdf').substring(0, 60) } }),
    muteHttpExceptions: true
  });
  const startCode = start.getResponseCode();
  if (startCode < 200 || startCode >= 300) {
    throw new Error('Falha ao iniciar envio do PDF ao Gemini (HTTP ' + startCode + '): ' + extrairErroGemini_(start.getContentText()));
  }

  const startHeaders = start.getAllHeaders();
  const uploadUrl = obterCabecalhoHttp_(startHeaders, 'x-goog-upload-url');
  if (!uploadUrl) throw new Error('O Gemini não forneceu o endereço temporário para envio do Manual.');

  // O Files API pode informar a granularidade obrigatória da sessão. No erro observado
  // pelo projeto, essa granularidade foi 8.388.608 bytes (8 MiB).
  const granularidadeInformada = Number(obterCabecalhoHttp_(startHeaders, 'x-goog-upload-chunk-granularity'));
  const granularidade = (Number.isFinite(granularidadeInformada) && granularidadeInformada > 0)
    ? granularidadeInformada
    : (8 * 1024 * 1024);
  let chunkSize = Math.max(Number(CONFIG.TAMANHO_BLOCO_UPLOAD_BYTES) || granularidade, granularidade);
  if (chunkSize % granularidade !== 0) chunkSize = Math.ceil(chunkSize / granularidade) * granularidade;

  const driveUrl = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true';
  const oauth = ScriptApp.getOAuthToken();
  let offset = 0;
  let respostaFinal = null;
  let numeroBloco = 0;
  const totalBlocos = Math.ceil(total / chunkSize);

  while (offset < total) {
    const end = Math.min(offset + chunkSize - 1, total - 1);
    const esperado = end - offset + 1;
    let downloadResponse = null;
    let chunkBytes = null;
    let uploadResponse = null;

    try {
      downloadResponse = UrlFetchApp.fetch(driveUrl, {
        method: 'get',
        headers: {
          'Authorization': 'Bearer ' + oauth,
          'Range': 'bytes=' + offset + '-' + end
        },
        muteHttpExceptions: true
      });

      const downloadCode = downloadResponse.getResponseCode();
      if (downloadCode !== 206) {
        // Não tentar ler o corpo de uma resposta 200: isso pode significar que o servidor ignorou Range e retornou o PDF inteiro.
        throw new Error('O Google Drive não forneceu um bloco parcial (HTTP ' + downloadCode + '). Confirme o acesso pela API do Drive e tente novamente.');
      }

      const contentRange = obterCabecalhoHttp_(downloadResponse.getAllHeaders(), 'content-range');
      if (!contentRange || !new RegExp('^bytes\\s+' + offset + '-' + end + '/' + total + '$', 'i').test(contentRange.trim())) {
        throw new Error('O Google Drive não confirmou o intervalo exato solicitado (' + offset + '-' + end + '). Envio interrompido para evitar PDF incompleto ou corrompido.');
      }

      chunkBytes = downloadResponse.getContent();
      if (!chunkBytes || chunkBytes.length !== esperado) {
        throw new Error('O bloco ' + (numeroBloco + 1) + ' do Manual chegou incompleto (' + (chunkBytes ? chunkBytes.length : 0) + ' de ' + esperado + ' bytes).');
      }

      const finalChunk = (end + 1) >= total;
      if (!finalChunk && (chunkBytes.length % granularidade) !== 0) {
        throw new Error('O bloco ' + (numeroBloco + 1) + ' não respeita a granularidade exigida pelo Gemini (' + granularidade + ' bytes).');
      }
      uploadResponse = UrlFetchApp.fetch(uploadUrl, {
        method: 'post',
        contentType: 'application/pdf',
        headers: {
          'X-Goog-Upload-Offset': String(offset),
          'X-Goog-Upload-Command': finalChunk ? 'upload, finalize' : 'upload'
        },
        payload: chunkBytes,
        muteHttpExceptions: true
      });

      const uploadCode = uploadResponse.getResponseCode();
      const uploadOk = finalChunk
        ? (uploadCode >= 200 && uploadCode < 300)
        : (uploadCode >= 200 && uploadCode < 300 || uploadCode === 308);
      if (!uploadOk) {
        throw new Error('Falha ao enviar o bloco ' + (numeroBloco + 1) + '/' + totalBlocos + ' ao Gemini (HTTP ' + uploadCode + '): ' + extrairErroGemini_(uploadResponse.getContentText()));
      }

      if (finalChunk) respostaFinal = uploadResponse.getContentText();
      offset = end + 1;
      numeroBloco++;
    } finally {
      // Solta referências a respostas e bytes em cada iteração para manter baixo o pico de memória.
      chunkBytes = null;
      downloadResponse = null;
      uploadResponse = null;
    }
  }

  if (!respostaFinal) throw new Error('O envio do PDF terminou sem uma confirmação final do Gemini.');
  const data = JSON.parse(respostaFinal);
  let info = data.file || data;
  if (info.name && (!info.uri || (info.state && info.state !== 'ACTIVE'))) {
    // Aguarda o processamento do documento no Files API.
    for (let attempt = 0; attempt < 12; attempt++) {
      Utilities.sleep(1000);
      const check = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + info.name, {
        headers: { 'x-goog-api-key': apiKey },
        muteHttpExceptions: true
      });
      if (check.getResponseCode() >= 200 && check.getResponseCode() < 300) {
        info = JSON.parse(check.getContentText());
        if (info.state === 'ACTIVE' && info.uri) break;
        if (info.state === 'FAILED') throw new Error('O Gemini não conseguiu processar o arquivo PDF enviado.');
      }
    }
  }
  if (!info.uri || (info.state && info.state !== 'ACTIVE')) {
    throw new Error('O PDF foi transferido, mas o Gemini ainda não concluiu o processamento. Execute prepararManualNoGemini() novamente daqui a pouco.');
  }

  // Confirma pelo metadata do Files API que o Gemini recebeu exatamente o tamanho do PDF do Drive.
  // Isso valida a transferência de todos os bytes; a interpretação das páginas ainda deve ser
  // testada com perguntas representativas antes da operação.
  if ((!info.sizeBytes || !info.mimeType) && info.name) {
    info = obterMetadataArquivoGemini_(apiKey, info.name);
  }
  const tamanhoGemini = Number(info.sizeBytes || 0);
  if (!tamanhoGemini || tamanhoGemini !== total) {
    throw new Error('O Gemini não confirmou o tamanho integral do Manual. Drive: ' + total + ' bytes; Gemini: ' + (info.sizeBytes || 'não informado') + ' bytes. O arquivo não foi colocado no cache.');
  }
  if (String(info.mimeType || '').toLowerCase() !== 'application/pdf') {
    throw new Error('O Gemini recebeu um arquivo com tipo diferente de application/pdf. Tipo informado: ' + String(info.mimeType || 'não informado'));
  }
  return {
    uri: info.uri,
    name: info.name,
    sizeBytes: String(info.sizeBytes),
    mimeType: info.mimeType,
    sha256Hash: info.sha256Hash || '',
    state: info.state || 'ACTIVE'
  };
}

/** Consulta os metadados do arquivo remoto sem baixar novamente seu conteúdo. */
function obterMetadataArquivoGemini_(apiKey, resourceName) {
  const response = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/' + String(resourceName).replace(/^\//, ''), {
    method: 'get',
    headers: { 'x-goog-api-key': apiKey },
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Não foi possível validar os metadados do PDF no Gemini (HTTP ' + code + '): ' + extrairErroGemini_(response.getContentText()));
  }
  return JSON.parse(response.getContentText());
}

/**
 * Verifica se o arquivo ativo no Gemini tem o mesmo tamanho e tipo do PDF original no Drive.
 * Execute depois de prepararManualNoGemini(). Não baixa o PDF novamente nem consome tokens.
 */
function verificarManualPreparadoNoGemini() {
  const file = DriveApp.getFileById(CONFIG.MANUAL_FILE_ID);
  const driveSize = file.getSize();
  const keys = lerChavesGemini_();
  if (!keys.length) throw new Error('Não há chaves Gemini cadastradas.');
  const props = PropertiesService.getScriptProperties();
  const lastOk = Number(props.getProperty('GEMINI_ULTIMA_CHAVE_OK'));
  const order = [];
  if (Number.isInteger(lastOk) && lastOk >= 0 && lastOk < keys.length) order.push(lastOk);
  keys.forEach(function (_, i) { if (order.indexOf(i) === -1) order.push(i); });

  for (let i = 0; i < order.length; i++) {
    const index = order[i];
    const cacheProp = 'GEMINI_PDF_' + hashTexto_(keys[index]).substring(0, 18);
    const cached = props.getProperty(cacheProp);
    if (!cached) continue;
    const entry = JSON.parse(cached);
    if (!entry.name) continue;
    const meta = obterMetadataArquivoGemini_(keys[index], entry.name);
    const remoteSize = Number(meta.sizeBytes || 0);
    const sizeOk = remoteSize === driveSize;
    const mimeOk = String(meta.mimeType || '').toLowerCase() === 'application/pdf';
    const stateOk = String(meta.state || '').toUpperCase() === 'ACTIVE';
    return {
      ok: sizeOk && mimeOk && stateOk,
      arquivoDrive: file.getName(),
      tamanhoDriveBytes: driveSize,
      tamanhoGeminiBytes: remoteSize,
      mimeDrive: file.getMimeType(),
      mimeGemini: meta.mimeType || '',
      estadoGemini: meta.state || '',
      sha256Gemini: meta.sha256Hash || '',
      uriDisponivel: !!meta.uri,
      mensagem: sizeOk && mimeOk && stateOk
        ? 'O Gemini confirmou arquivo PDF ativo com o mesmo número de bytes do original no Google Drive. A transferência integral foi confirmada; valide a leitura do conteúdo com perguntas de páginas diferentes.'
        : 'A validação não foi aprovada. O tamanho, o tipo ou o estado do arquivo no Gemini não corresponde ao PDF original.'
    };
  }
  throw new Error('Não encontrei arquivo preparado em cache para as chaves atuais. Execute prepararManualNoGemini() primeiro.');
}

function obterCabecalhoHttp_(headers, nome) {
  const alvo = String(nome || '').toLowerCase();
  const all = headers || {};
  const found = Object.keys(all).find(function (key) { return String(key).toLowerCase() === alvo; });
  if (!found) return '';
  const value = all[found];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function formatarTamanhoMB_(bytes) {
  return Math.round(Number(bytes || 0) / 1024 / 1024 * 100) / 100;
}

function lerChavesGemini_() {
  const raw = PropertiesService.getScriptProperties().getProperty(PROP.API_KEYS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(function (k) { return String(k || '').trim(); })
      .filter(function (k) { return k.length >= 25 && !/^COLE_/i.test(k) && !/^SUA_CHAVE/i.test(k); })
      .slice(0, 3);
  } catch (e) { return []; }
}

function obterSessao_(token, tipo) {
  const t = String(token || '').trim();
  if (!t || t.length < 30 || t.length > 120) return null;
  const cache = CacheService.getScriptCache();
  const key = (tipo === 'ADMIN' ? 'ADMIN_' : 'SESSAO_') + t;
  const raw = cache.get(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    return session.tipo === tipo ? session : null;
  } catch (e) { return null; }
}

function tocarEscolaAtiva_(pin) {
  CacheService.getScriptCache().put('ATIVA_' + String(pin), String(Date.now()), 180);
}

function incrementarContagemPergunta_(pin) {
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    lock.waitLock(5000);
    acquired = true;
    const props = PropertiesService.getScriptProperties();
    const key = 'PERGUNTAS_' + String(pin);
    const current = Number(props.getProperty(key) || 0);
    props.setProperty(key, String(current + 1));
  } catch (e) {
    console.error('Falha ao atualizar contador de perguntas: ' + e);
  } finally {
    if (acquired) lock.releaseLock();
  }
}

function novoToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').substring(0, 8);
}

function hashTexto_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

function comparacaoSegura_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function registrarLog_(escola, acao, pergunta, resposta, modelo, resultado) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sh = obterAbaLogs_();
    const sess = ESCOLAS.find(function (e) { return e.nome === escola; });
    const row = [
      new Date(),
      String(escola || '—').substring(0, 120),
      sess ? sess.pin : (String(escola) === 'ADMIN' ? 'ADMIN' : '—'),
      String(acao || '').substring(0, 60),
      String(pergunta || '').substring(0, 500),
      String(resposta || '').substring(0, 700),
      String(modelo || '').substring(0, 80),
      String(resultado || '').substring(0, 60)
    ];
    sh.appendRow(row);
  } catch (e) {
    console.error('Falha ao registrar log: ' + e);
  } finally {
    try { lock.releaseLock(); } catch (e) { /* lock não adquirido */ }
  }
}

function obterAbaLogs_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(PROP.LOG_SHEET_ID);
  let ss;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { id = ''; }
  }
  if (!id) {
    ss = SpreadsheetApp.create('ENEM Plantão 2026 — Registros administrativos (privado)');
    props.setProperty(PROP.LOG_SHEET_ID, ss.getId());
  }
  let sh = ss.getSheetByName('LOGS');
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName('LOGS');
    sh.appendRow(['Data/hora', 'Escola', 'PIN', 'Ação', 'Pergunta', 'Resposta/resumo', 'Modelo', 'Resultado']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function lerLogs_(limite) {
  try {
    const sh = obterAbaLogs_();
    const last = sh.getLastRow();
    if (last < 2) return [];
    const count = Math.min(last - 1, Math.max(1, Number(limite) || 1000));
    const start = last - count + 1;
    return sh.getRange(start, 1, count, 8).getValues();
  } catch (e) {
    console.error('Falha ao ler logs: ' + e);
    return [];
  }
}

function formatarData_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
}

function extrairErroGemini_(body) {
  try {
    const obj = JSON.parse(body || '{}');
    return String((obj.error && obj.error.message) || body || 'Erro não especificado').substring(0, 500);
  } catch (e) { return String(body || 'Erro não especificado').substring(0, 500); }
}

function mensagemErroSegura_(err) {
  const raw = String((err && err.message) || err || 'Erro desconhecido');
  if (/quota|rate.?limit|resource.?exhausted|HTTP 429|429/i.test(raw)) {
    return 'O Gemini informou limite de uso (HTTP 429). Aguarde a renovação da cota ou confira o limite do projeto no Google AI Studio. Chaves do mesmo projeto compartilham a cota.';
  }
  if (/API key|api_key|invalid.?key|unauthorized|HTTP 401|HTTP 403|401|403/i.test(raw)) {
    return 'O Gemini recusou a credencial ou a permissão (401/403). Confira se a chave pertence a um projeto com a Gemini API habilitada.';
  }
  if (/drive|permission|not have permission|file not found|HTTP 404.*file/i.test(raw)) {
    return 'Não consegui acessar o Manual no Google Drive. Confira se a conta que executa o Web App tem acesso ao PDF e se o ID está correto.';
  }
  if (/model|modelo|not found|HTTP 404/i.test(raw)) {
    return 'O modelo Gemini configurado não foi encontrado ou não está disponível para esta chave. Confira MODELO_GEMINI no Code.gs e a lista atual de modelos da API.';
  }
  if (/out of memory|memory|memória|falta de memória|heap|allocation failed/i.test(raw)) {
    return 'O Apps Script ficou sem memória durante a operação. Esta versão transfere o PDF em blocos menores; execute prepararManualNoGemini() novamente. Se persistir, verifique o tamanho do PDF e os registros em Apps Script > Execuções.';
  }
  if (/UPLOAD_EM_ANDAMENTO/i.test(raw)) {
    return 'O Manual já está sendo preparado em outra execução. Aguarde a conclusão e tente novamente.';
  }
  if (/timed out|timeout|exceeded maximum execution time/i.test(raw)) {
    return 'A transferência ou consulta excedeu o tempo de execução do Apps Script. Execute prepararManualNoGemini() separadamente no editor e aguarde a conclusão antes das perguntas.';
  }
  return raw.substring(0, 700);
}
