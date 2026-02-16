const crypto = require('crypto');

try {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519', {
        privateKeyEncoding: {
            type: 'openssh',
            format: 'pem'
        },
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        }
    });

    console.log('--- Private Key ---');
    console.log(privateKey.toString().substring(0, 40));
    console.log('--- Public Key ---');
    console.log(publicKey.toString().substring(0, 40));
} catch (e) {
    console.error('Error generating with openssh type:', e.message);
}
