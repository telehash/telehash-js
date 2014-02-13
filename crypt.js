try{
  var ursa = require("ursa"); // only need this to do the rsa encryption, not supported in crypto.*
  var ecc = require("ecc"); // for the elliptic curve diffie hellman  not in crypto.*
}catch(E){}

var crypto = require("crypto");
var CS = {"1":{},"1r":{}};

exports.upgrade = function(crypt){
  if(!ecc || !ursa) return crypt;
  try {
    var eccKey = new ecc.ECKey(ecc.ECCurves.nistp256);
    var eccKey = new ecc.ECKey(ecc.ECCurves.secp160r1);
    var aes = crypto.createCipheriv("AES-128-CTR", crypto.randomBytes(16), crypto.randomBytes(16));
// use this after v0.12.x https://github.com/joyent/node/pull/6317
//    var aes = crypto.createCipheriv("AES-256-GCM", crypto.randomBytes(32), crypto.randomBytes(16));
  }catch(E){
//    console.log(E);
  };
  if(!eccKey || !aes) return crypt;

  // upgrade functions to node native ones
  crypt.pdecode = pdecode;
  crypt.pencode = pencode;
  crypt.randomHEX = randomHEX;
  crypt.CS["1"] = CS["1"];
  crypt.CS["1r"] = CS["1r"];
  return crypt;
}

CS["1"] = {
  genkey:function(ret,cbDone,cbStep)
  {
    var k = new ecc.ECKey(ecc.ECCurves.secp160r1);
    ret["1"] = k.PublicKey.slice(1).toString("base64");
    ret["1_"] = k.PrivateKey.toString("base64");
    ret.parts["1"] = crypto.createHash("SHA1").update(k.PublicKey.slice(1)).digest("hex");
    cbDone();
  },

  loadkey:function(id, pub, priv)
  {
    if(typeof pub == "string") pub = new Buffer(pub,"base64");
    if(!Buffer.isBuffer(pub) || pub.length != 40) return "invalid public key";
    id.key = pub;
    id.public = new ecc.ECKey(ecc.ECCurves.secp160r1, Buffer.concat([new Buffer("04","hex"),id.key]), true);
    if(!id.public) return "public key load failed";
  //  console.log("CLOADKEY",id.hashname,id.key.length,id.public.PublicKey.toString("hex"));

    if(priv)
    {
      if(typeof priv == "string") priv = new Buffer(priv,"base64");
      if(!Buffer.isBuffer(priv) || priv.length != 20) return "invalid private key";
      id.private = new ecc.ECKey(ecc.ECCurves.secp160r1, priv);
      if(!id.private) return "private key load failed";
    }
    return false;
  }
}

CS["1r"] = {
  genkey:function(ret,cbDone,cbStep)
  {
    var kpair = ursa.generatePrivateKey();
    ret["1r"] = str2der(kpair.toPublicPem("utf8")).toString("base64");
    ret["1r_"] = str2der(kpair.toPrivatePem("utf8")).toString("base64");
    ret.parts["1r"] = crypto.createHash("SHA256").update(str2der(kpair.toPublicPem("utf8"))).digest("hex");
    cbDone();
  },

  loadkey:function(id, pub, priv)
  {  
    // take pki or ber format
    if(typeof pub == "string") pub = str2der(pub);
    id.key = pub;
    id.public = ursa.coercePublicKey(der2pem(pub,"PUBLIC"));
    if(priv)
    {
      if(typeof priv == "string") priv = str2der(priv);
      id.private = ursa.coercePrivateKey(der2pem(priv,"RSA PRIVATE"));
    }
    return false;
  },

  openize:function(id, to, open, inner)
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
  },

  deopenize:function(id, open)
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
    var verify;
    try{
      verify = ukey.hashAndVerify("sha256", open.body, decsig, undefined, ursa.RSA_PKCS1_PADDING);
    }catch(E){
      console.log("verify failed",E,open.js.iv,aeskey.toString("hex"));
    }
    return {ecc:eccKey, rsa:key2der(ukey), js:deciphered.js, verify:verify};
  },

  // set up the line enc/dec keys
  openline:function(from, open)
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
  },

  lineize:function(to, packet)
  {
    var wrap = {type:"line"};
    wrap.line = to.lineIn;
    var iv = crypto.randomBytes(16);
    wrap.iv = iv.toString("hex");
    var aes = crypto.createCipheriv("AES-256-CTR", to.encKey, iv);
    var body = Buffer.concat([aes.update(pencode(packet.js,packet.body)), aes.final()]);
  	return pencode(wrap,body);
  },

  delineize:function(from, packet)
  {
    var aes = crypto.createDecipheriv("AES-256-CTR", packet.from.decKey, new Buffer(packet.js.iv, "hex"));
    var deciphered = pdecode(Buffer.concat([aes.update(packet.body), aes.final()]));
    if(!deciphered) return;
    packet.js = deciphered.js;
    packet.body = deciphered.body;
    packet.lineok = true;
  }
}

var PEM_REGEX = /^(-----BEGIN (.*) KEY-----\r?\n([\/+=a-zA-Z0-9\r\n]*)\r?\n-----END \2 KEY-----\r?\n)/m;
function str2der(str)
{
  var r = PEM_REGEX.exec(str);
  var b64 = r ? r[3] : str;
  return new Buffer(b64, "base64");  
}
function der2pem(der,type)
{
  if(!der || !Buffer.isBuffer(der)) return false;
  var b64 = der.toString("base64");
  if(!b64) return false;
  b64 = b64.match(/.{1,60}/g).join("\n");
  return "-----BEGIN "+type+" KEY-----\n"+b64+"\n-----END "+type+" KEY-----\n";  
}


// return random bytes, in hex
function randomHEX(len)
{
	return crypto.randomBytes(len).toString("hex");
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