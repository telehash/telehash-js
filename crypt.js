try{
  var ursa = require("ursa"); // only need this to do the rsa encryption, not supported in crypto.*
  var ecc = require("ecc"); // for the elliptic curve diffie hellman  not in crypto.*
}catch(E){}

var crypto = require("crypto");

exports.validate = function(){
  if(!ecc || !ursa) return false;
  try {
    var eccKey = new ecc.ECKey(ecc.ECCurves.nistp256);
    var aes = crypto.createCipheriv("AES-256-CTR", crypto.randomBytes(32), crypto.randomBytes(16));
  }catch(E){};
  if(!eccKey || !aes) return false;
  
  return true;
}

// these are all the crypto/binary dependencies needed by thjs
exports.pub2key = pub2key;
exports.pri2key = pri2key;
exports.der2hn = der2hn;
exports.key2der = key2der;
exports.der2key = der2key;
exports.der2der = der2der;
exports.randomHEX = randomHEX;
exports.openize = openize;
exports.deopenize = deopenize;
exports.openline = openline;
exports.lineize = lineize;
exports.delineize = delineize;
exports.pencode = pencode;
exports.pdecode = pdecode;
exports.genkey = genkey;

function genkey(callback){
  var key = ursa.generatePrivateKey();
  callback(null, {public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")});
}

// pem conversion to local key format
function pub2key(pem)
{
  try{
    var ret = ursa.coercePublicKey(pem);
  }catch(E){}
  return ret;
}
function pri2key(pem)
{
  try{
    var ret = ursa.coercePrivateKey(pem);
  }catch(E){}
  return ret;
}

// der format key to string hashname
function der2hn(der)
{
  var sha = crypto.createHash("SHA256");
  sha.update(der);
  return sha.digest("hex");
}

// wrapper to get raw der bytes from native key format (or pem) and vice versa
// ursa only supports PEM so we have to mangle DER around for it
var PEM_REGEX = /^(-----BEGIN (.*) KEY-----\r?\n([\/+=a-zA-Z0-9\r\n]*)\r?\n-----END \2 KEY-----\r?\n)/m;
function key2der(key)
{
  if(typeof key == "string") key = pub2key(key);
  var pem = key.toPublicPem("utf8");
  var r = PEM_REGEX.exec(pem);
  var b64 = r ? r[3] : pem;
  return new Buffer(b64, "base64");
}
function der2key(der)
{
  if(!der || !Buffer.isBuffer(der)) return false;
  var b64 = der.toString("base64");
  if(!b64) return false;
  b64 = b64.match(/.{1,60}/g).join("\n");
  return pub2key("-----BEGIN PUBLIC KEY-----\n"+b64+"\n-----END PUBLIC KEY-----\n");
}

// validate der
function der2der(der)
{
	return key2der(der2key(der));
}

// return random bytes, in hex
function randomHEX(len)
{
	return crypto.randomBytes(len).toString("hex");
}

function openize(id, to)
{
	if(!to.ecc) to.ecc = new ecc.ECKey(ecc.ECCurves.nistp256);
	if(!to.lineOut) to.lineOut = randomHEX(16);
  if(!to.lineAt) to.lineAt = Date.now();
  if(!to.public) to.public = der2key(to.der);
	var inner = {}
	inner.at = to.lineAt;
	inner.to = to.hashname;
	inner.line = to.lineOut;
	var body = pencode(inner, id.der);
	var open = {type:"open"};
	var iv = crypto.randomBytes(16);
	open.iv = iv.toString("hex");

	// now encrypt the body
  var aes = crypto.createCipheriv("AES-256-CTR", crypto.createHash("sha256").update(to.ecc.PublicKey).digest(), iv);
  body = Buffer.concat([aes.update(body),aes.final()]);

	// sign & encrypt the sig
  var sig = id.private.hashAndSign("sha256", body, undefined, undefined, ursa.RSA_PKCS1_PADDING);
  var aeskey = crypto.createHash("sha256").update(to.ecc.PublicKey).update(new Buffer(to.lineOut,"hex")).digest();
  var aes = crypto.createCipheriv("AES-256-CTR", aeskey, iv);
  open.sig = Buffer.concat([aes.update(sig),aes.final()]).toString("base64");

	// encrypt the ecc key
  open.open = to.public.encrypt(to.ecc.PublicKey, undefined, "base64", ursa.RSA_PKCS1_OAEP_PADDING);

  //	console.log(open, body.length());
	var packet = pencode(open, body);
	return packet;
}

function deopenize(id, open)
{
  // decrypt the ecc public key and verify/load it
  try{
    var eccpub = id.private.decrypt(open.js.open, "base64", undefined, ursa.RSA_PKCS1_OAEP_PADDING);
  }catch(E){
    err = E;
  }
  if(!eccpub) return {err:"couldn't decrypt open"};
  try {
    var eccKey = new ecc.ECKey(ecc.ECCurves.nistp256, eccpub, true);
  }catch(E){};
  if(!eccKey) return {err:"invalid open ecc key "+eccpub.toString("hex")};
  
  // decipher the body as a packet so we can examine it
  if(!open.body) return {err:"body missing on open"};
  var aes = crypto.createDecipheriv("AES-256-CTR", crypto.createHash('sha256').update(eccpub).digest(), new Buffer(open.js.iv, "hex"));
  var deciphered = pdecode(Buffer.concat([aes.update(open.body),aes.final()]));
  if(!deciphered) return {err:"invalid body attached"};

  // extract attached public key
  if(!deciphered.body) return {err:"open missing attached key"};
	var ukey = der2key(deciphered.body);
  if(!ukey) return {err:"invalid attached key"};
  if(ukey.getModulus().length < 256) return {err:"key to small "+ukey.getModulus().length};

  // decrypt signature
  var aeskey = crypto.createHash('sha256').update(eccpub).update(new Buffer(deciphered.js.line,"hex")).digest()
  var aes = crypto.createDecipheriv("AES-256-CTR", aeskey, new Buffer(open.js.iv, "hex"));
  var decsig = Buffer.concat([aes.update(open.js.sig, "base64"),aes.final()]);

  // verify signature
  try{
    var verify = ukey.hashAndVerify("sha256", open.body, decsig, undefined, ursa.RSA_PKCS1_PADDING);
  }catch(E){}
  return {ecc:eccKey, rsa:key2der(ukey), js:deciphered.js, verify:verify};
}

// set up the line enc/dec keys
function openline(from, open)
{
  var ecdhe = from.ecc.deriveSharedSecret(open.ecc);
  from.encKey = crypto.createHash("sha256")
    .update(ecdhe)
    .update(new Buffer(from.lineOut, "hex"))
    .update(new Buffer(from.lineIn, "hex"))
    .digest();
  from.decKey = crypto.createHash("sha256")
    .update(ecdhe)
    .update(new Buffer(from.lineIn, "hex"))
    .update(new Buffer(from.lineOut, "hex"))
    .digest();
  return true;
}

// encrypt the packet
function lineize(to, packet)
{
  var wrap = {type:"line"};
  wrap.line = to.lineIn;
  var iv = crypto.randomBytes(16);
  wrap.iv = iv.toString("hex");
  var aes = crypto.createCipheriv("AES-256-CTR", to.encKey, iv);
  var body = Buffer.concat([aes.update(pencode(packet.js,packet.body)), aes.final()]);
	return pencode(wrap,body);
}

// decrypt the contained packet
function delineize(packet)
{
  var aes = crypto.createDecipheriv("AES-256-CTR", packet.from.decKey, new Buffer(packet.js.iv, "hex"));
  var deciphered = pdecode(Buffer.concat([aes.update(packet.body), aes.final()]));
  if(!deciphered) return;
  packet.js = deciphered.js;
  packet.body = deciphered.body;
  packet.lineok = true;
}

function ecdh(priv, pubbytes) {
}

// encode a packet
function pencode(js, body)
{
  var jsbuf = new Buffer(js?JSON.stringify(js):"", "utf8");
  if(typeof body == "string") body = new Buffer(body, "binary");
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(jsbuf.length, 0);
  return Buffer.concat([len, jsbuf, body]);
}

// packet decoding
function pdecode(packet)
{
  var buf = (typeof packet == "string") ? new Buffer(packet, "binary") : packet;

  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len > (buf.length - 2)) return undefined;

  // parse out the json
  try {
      var js = (len>0)?JSON.parse(buf.toString("utf8",2,len+2)):{};
  } catch(E) {
    console.log("couldn't parse JS",buf.toString("hex"),E,packet.sender);
    return undefined;
  }

  // attach any body
  var body = buf.slice(len + 2);

  return {js:js, body:body};
}