// Loaded before the CLI by the regression test. Never use a real network transport.
let authenticationAttempts = 0;
globalThis.fetch = async (url) => {
  if (!String(url).startsWith('https://example.test/')) throw new Error('Unexpected synthetic URL');
  const secret = 'SYNTHETIC-CLI-PRIVATE-DETAIL';
  if (String(url).includes('GetDataCenterList')) {
    return new Response(JSON.stringify([{ Id: 'synthetic-account', Name: secret, Number: secret }]));
  }
  if (String(url).includes('GetPublicKeyInfo')) return new Response('""', {
    headers: { 'Set-Cookie': `ASP.NET_SessionId=${secret}; Path=/` },
  });
  if (String(url).includes('ValidateLoginInfo')) {
    authenticationAttempts++;
    if (authenticationAttempts !== 1) throw new Error('Unexpected duplicate authentication');
    if (process.env.DIAGNOSTIC_FIXTURE_CASE === 'exception') throw new Error(secret);
    if (process.env.DIAGNOSTIC_FIXTURE_CASE === 'envelope') return new Response(`response_error: ${secret}`);
    return new Response(JSON.stringify({ LoginResultType: 1, AccessToken: secret, Message: secret, MessageCode: secret }));
  }
  throw new Error('Unexpected synthetic method');
};
