const { utils } = require('ssh2'); 
try {
  console.log('Generating ED25519...');
  const start = Date.now();
  const key = utils.generateKeyPairSync('ed25519');
  console.log('ED25519 Time:', Date.now() - start);
  console.log('Private Head:', key.private.substring(0, 40));
  
  console.log('Generating RSA 2048...');
  const start2 = Date.now();
  const key2 = utils.generateKeyPairSync('rsa', { bits: 2048 });
  console.log('RSA 2048 Time:', Date.now() - start2);
} catch (e) { console.error(e); }
