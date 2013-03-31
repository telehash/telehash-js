var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./operator.json", JSON.stringify({publicKey:key.toPublicPem("utf8"), privateKey:key.toPrivatePem("utf8")}, null, 4));
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./client.json", JSON.stringify({publicKey:key.toPublicPem("utf8"), privateKey:key.toPrivatePem("utf8")}, null, 4));
