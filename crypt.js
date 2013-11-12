try{
  var ursa = require("ursa"); // only need this to do the rsa encryption, not supported in crypto.*
  var ecc = require("ecc"); // for the elliptic curve diffie hellman  not in crypto.*
}catch(E){}

exports.validate = function(){
  return false;
  // TODO check ecc since old openssl versions fail
  if(ursa && ecc) return true;
}

// these are all the crypto/binary dependencies needed by thjs
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
exports.ecdh = ecdh;
exports.genkey = genkey;

function genkey(callback){
  var key = ursa.generatePrivateKey();
  callback(null, {public:key.toPublicPem("utf8"), private:key.toPrivatePem("utf8")});
}

// der format key to string hashname
function der2hn(der)
{
	var md = forge.md.sha256.create();
	md.update(der);
	return md.digest().toHex();	
}

// wrapper to get raw der bytes from native key format (or pem) and vice versa
function key2der(key)
{
  if(typeof key == "string") key = pki.publicKeyFromPem(key);
  return asn1.toDer(pki.publicKeyToAsn1(key)).bytes();
}
function der2key(der)
{
  return pki.publicKeyFromAsn1(asn1.fromDer(der));
}

// validate der
function der2der(der)
{
	return key2der(der2key(der));
}

// return random bytes, in hex
function randomHEX(len)
{
	return forge.util.bytesToHex(forge.random.getBytesSync(len));
}

// zero prepad
function unstupid(hex,len)
{
	return (hex.length >= len) ? hex : unstupid("0"+hex,len);
}

function ecKey()
{
	var c = getSECCurveByName("secp256r1");
	//var curve = new ECCurveFp(c.getCurve().getQ(), c.getCurve().getA().toBigInteger(), c.getCurve().getB().toBigInteger());
	//console.log(curve);
	var n = c.getN();
	var n1 = n.subtract(BigInteger.ONE);
	var r = new BigInteger(n.bitLength(), new SecureRandom());
	var priecc = r.mod(n1).add(BigInteger.ONE);
	//console.log(priecc);

	//var G = new ECPointFp(c.getCurve(), c.getCurve().fromBigInteger(c.getG().getX().toBigInteger(), c.getG().getY().toBigInteger());
	//console.log(G);
	var P = c.getG().multiply(priecc);
	var pubhex = "04"+unstupid(P.getX().toBigInteger().toString(16),64)+unstupid(P.getY().toBigInteger().toString(16),64);
	P.uncompressed = forge.util.hexToBytes(pubhex);
	//console.log(forge.util.createBuffer(forge.util.hexToBytes(P.getX().toBigInteger().toString(16))).toHex());
//  console.log(P.uncompressed.length,pubhex,forge.util.bytesToHex(P.uncompressed));
	return {curve:c, private:priecc, public:P};
}

function openize(id, to)
{
	if(!to.ecc) to.ecc = ecKey();
	if(!to.lineOut) to.lineOut = randomHEX(16);
  if(!to.public) to.public = der2key(to.der);
	var inner = {}
	inner.at = Date.now();
	inner.to = to.hashname;
	inner.line = to.lineOut;
	var body = pencode(inner, id.der);
	var open = {type:"open"};
	var iv = forge.random.getBytesSync(16);
	open.iv = forge.util.bytesToHex(iv);

	// now encrypt the body
	var md = forge.md.sha256.create();
	md.update(to.ecc.public.uncompressed);
	var cipher = forge.aes.createEncryptionCipher(md.digest(), "CTR");
	cipher.start(iv);
	cipher.update(body);
	cipher.finish();
	body = cipher.output;

	// sign & encrypt the sig
	var md = forge.md.sha256.create();
	md.update(body.bytes());
	var sig = id.private.sign(md);
	var md = forge.md.sha256.create();
	md.update(to.ecc.public.uncompressed);
	md.update(forge.util.hexToBytes(to.lineOut));
	var cipher = forge.aes.createEncryptionCipher(md.digest(), "CTR");
	cipher.start(iv);
  cipher.update(forge.util.createBuffer(sig));
	cipher.finish();
  open.sig = forge.util.encode64(cipher.output.bytes());

	// encrypt the ecc key
	open.open = forge.util.encode64(to.public.encrypt(to.ecc.public.uncompressed, "RSA-OAEP"));
//	console.log(open, body.length());
	var packet = pencode(open, body.bytes());
	return packet.bytes();
}

function deopenize(id, open)
{
	// decrypt the ecc key
	var dec = forge.util.decode64(open.js.open);
	var ecpub = id.private.decrypt(dec, "RSA-OAEP");
//	console.log(ecpub.length);
	// compose the aes key
	var md = forge.md.sha256.create();
	md.update(ecpub);
	var cipher = forge.aes.createDecryptionCipher(md.digest(), "CTR");
	cipher.start(forge.util.hexToBytes(open.js.iv));
	cipher.update(forge.util.createBuffer(open.body));
	cipher.finish();
	var inner = pdecode(cipher.output);
//	console.log(inner);
	var rsapub = der2key(inner.body);
//	console.log("from", key2hn(rsapub));
	// decode the signature
	var md = forge.md.sha256.create();
	md.update(ecpub);
	md.update(forge.util.hexToBytes(inner.js.line));
	var cipher = forge.aes.createDecryptionCipher(md.digest(), "CTR");
	cipher.start(forge.util.hexToBytes(open.js.iv));
	cipher.update(forge.util.createBuffer(forge.util.decode64(open.js.sig)));
	cipher.finish();
	var md = forge.md.sha256.create()
	md.update(open.body);
	var verify = rsapub.verify(md.digest().bytes(), cipher.output.bytes());
//	console.log("verify", verify);
	return {ecc:ecpub, rsa:key2der(rsapub), js:inner.js, verify:verify};
}

// set up the line enc/dec keys
function openline(from, open)
{
  var ecdhe = ecdh(from.ecc.private, open.ecc);
//  console.log("ECDHE",ecdhe.length, ecdhe, from.lineOut, from.lineIn);
	var md = forge.md.sha256.create()
	md.update(forge.util.hexToBytes(ecdhe));
	md.update(forge.util.hexToBytes(from.lineOut));
	md.update(forge.util.hexToBytes(from.lineIn));
	from.encKey = md.digest();
	var md = forge.md.sha256.create()
	md.update(forge.util.hexToBytes(ecdhe));
	md.update(forge.util.hexToBytes(from.lineIn));
	md.update(forge.util.hexToBytes(from.lineOut));
	from.decKey = md.digest();
//	console.log("encKey",from.encKey.toHex(),"decKey",from.decKey.toHex());
}

// encrypt the packet
function lineize(to, packet)
{
	var wrap = {type:"line"};
	wrap.line = to.lineIn;
	var iv = forge.random.getBytesSync(16);
	wrap.iv = forge.util.bytesToHex(iv);
	var buf = forge.util.createBuffer(pencode(packet.js,packet.body).bytes())
//	console.log("LINE",buf.toHex(),packet.toHex(),wrap.iv,to.encKey.toHex());

	// now encrypt the packet
	var cipher = forge.aes.createEncryptionCipher(to.encKey.copy(), "CTR");
	cipher.start(iv);
	cipher.update(buf);
	cipher.finish();
//	console.log("COUT",cipher.output.toHex());
	return pencode(wrap,cipher.output.bytes()).bytes();
}

// decrypt the contained packet
function delineize(packet)
{
	var cipher = forge.aes.createDecryptionCipher(packet.from.decKey.copy(), "CTR");
	cipher.start(forge.util.hexToBytes(packet.js.iv));
	cipher.update(forge.util.createBuffer(packet.body));
	cipher.finish();
	if(!cipher.output) return console.log("couldn't decrypt packet",packet.js.line, packet.sender);
	var deciphered = pdecode(cipher.output);
	if(!deciphered) return console.log("invalid decrypted packet", cipher.output);
  packet.js = deciphered.js;
  packet.body = deciphered.body;
	packet.lineok = true;
}

function ecdh(priv, pubbytes) {
  var curve = getSECCurveByName("secp256r1").getCurve();
  var uncompressed = forge.util.createBuffer(pubbytes);
//console.log(uncompressed.length(), uncompressed.bytes());
  uncompressed.getByte(); // chop off the 0x04
  var x = uncompressed.getBytes(32);
  var y = uncompressed.getBytes(32);
//console.log(x.length, y.length);
  if(y.length != 32) return false;
  var P = new ECPointFp(curve,
    curve.fromBigInteger(new BigInteger(forge.util.bytesToHex(x), 16)),
    curve.fromBigInteger(new BigInteger(forge.util.bytesToHex(y), 16)));
  var S = P.multiply(priv);
  return S.getX().toBigInteger().toString(16);
}

// encode a packet
function pencode(js, body)
{
  var jsbuf = forge.util.createBuffer(js?JSON.stringify(js):"", "utf8");
  var len = jsbuf.length();
  var ret = forge.util.createBuffer();
  // network order
  ret.putInt16(len);
  ret.putBytes(jsbuf.getBytes());
  if(body) ret.putBytes(body);
  return ret;
}

// packet decoding
function pdecode(packet)
{
  if(typeof packet == "string") packet = forge.util.createBuffer(packet);
  var len = packet.getInt16(packet);
  if(packet.length() < len) return console.log("packet too short",len,packet.length(),packet) && false;
  var jsonb = packet.getBytes(len);
  var body = packet.getBytes();
  var js;
	if(len > 0)
	{
	  try{ js = JSON.parse(jsonb); } catch(E){ return console.log("parse failed",jsonb) && false; }		
	}else{
		js = {};
	}
  return {js:js, body:body};
}