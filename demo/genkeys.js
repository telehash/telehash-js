var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./operator.json", JSON.stringify({public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")}, null, 4));
var key = require("ursa").generatePrivateKey();
require('fs').writeFileSync("./client.json", JSON.stringify({public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")}, null, 4));
