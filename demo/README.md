Run `node genkeys.js` that will create RSA keys stored in client.json and operator.json.

Then run `node operator.js` to start an operator, take the address it outputs and in another shell run `node client.js "fea43bab4ea8b60465a4ea0ada3e4cfe821869be,172.16.42.34,42424"` (replace the address) and it should start and connect to the operator.

