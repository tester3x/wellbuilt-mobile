// Test SHA256 hash to compare with VBA
const crypto = require('crypto');

const passcode = 'iH8pa$$words';
const hash = crypto.createHash('sha256').update(passcode, 'utf8').digest('hex').toLowerCase();

console.log('Passcode:', passcode);
console.log('SHA256 Hash:', hash);
console.log('');
console.log('Compare with VBA output and Firebase stored hash.');
