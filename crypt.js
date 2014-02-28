try{
  var ursa = require("ursa"); // only need this to do the rsa encryption, not supported in crypto.*
  var ecc = require("ecc"); // for the elliptic curve diffie hellman  not in crypto.*
  var sodium = require("sodium").api;
}catch(E){}

var sjcl = require("sjcl");
var crypto = require("crypto");
var CS = {};

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
  crypt.parts2hn = parts2hn;
  crypt.pdecode = pdecode;
  crypt.pencode = pencode;
  crypt.randomHEX = randomHEX;
  crypt.lineid = lineid;
  crypt.hashHEX = hashHEX;
  crypt.CS["1a"] = CS["1a"];
  crypt.CS["2a"] = CS["2a"];
  crypt.CS["3a"] = CS["3a"];
  return crypt;
}

CS["1a"] = {
  genkey:function(ret,cbDone,cbStep)
  {
    var k = new ecc.ECKey(ecc.ECCurves.secp160r1);
    ret["1a"] = k.PublicKey.slice(1).toString("base64");
    ret["1a_secret"] = k.PrivateKey.toString("base64");
    ret.parts["1a"] = crypto.createHash("SHA1").update(k.PublicKey.slice(1)).digest("hex");
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
  },
  
  openize:function(id, to, inner)
  {
  	if(!to.ecc) to.ecc = new ecc.ECKey(ecc.ECCurves.secp160r1);
    var eccpub = to.ecc.PublicKey.slice(1);

    // get the shared secret to create the iv+key for the open aes
    var secret = to.ecc.deriveSharedSecret(to.public);
    var key = secret.slice(0,16);
    var iv = new Buffer("00000000000000000000000000000001","hex");

    // encrypt the inner
    var aes = crypto.createCipheriv("AES-128-CTR", key, iv);
    var body = pencode(inner,id.cs["1a"].key);
    var cbody = Buffer.concat([aes.update(body), aes.final()]);
  
    // prepend the line public key and hmac it  
    var secret = id.cs["1a"].private.deriveSharedSecret(to.public);
    var macd = Buffer.concat([eccpub,cbody]);
    var hmac = crypto.createHmac('sha1', secret).update(macd).digest();
  
    // create final body
    var body = Buffer.concat([hmac,macd]);
    return pencode(0x1a, body);
  },
  
  deopenize:function(id, open)
  {
    var ret = {verify:false};
    if(!open.body) return ret;

    var mac1 = open.body.slice(0,20).toString("hex");
    var pub = open.body.slice(20,60);
    var cbody = open.body.slice(60);

    try{
      ret.linepub = new ecc.ECKey(ecc.ECCurves.secp160r1, Buffer.concat([new Buffer("04","hex"),pub]), true);      
    }catch(E){
      console.log("ecc err",E);
    }
    if(!ret.linepub) return ret;

    var secret = id.cs["1a"].private.deriveSharedSecret(ret.linepub);
    var key = secret.slice(0,16);
    var iv = new Buffer("00000000000000000000000000000001","hex");

    // aes-128 decipher the inner
    var aes = crypto.createDecipheriv("AES-128-CTR", key, iv);
    var body = Buffer.concat([aes.update(cbody), aes.final()]);
    var inner = pdecode(body);
    if(!inner) return ret;

    // verify+load inner key info
    var epub = new ecc.ECKey(ecc.ECCurves.secp160r1, Buffer.concat([new Buffer("04","hex"),inner.body]), true);
    if(!epub) return ret;
    ret.key = inner.body;
    if(typeof inner.js.from != "object" || !inner.js.from["1a"]) return ret;
    if(crypto.createHash("SHA1").update(inner.body).digest("hex") != inner.js.from["1a"]) return ret;

    // verify the hmac
    var secret = id.cs["1a"].private.deriveSharedSecret(epub);
    var mac2 = crypto.createHmac('sha1', secret).update(open.body.slice(20)).digest("hex");
    if(mac2 != mac1) return ret;
  
    // all good, cache+return
    ret.verify = true;
    ret.js = inner.js;
//    console.log("INNER",inner.js,ret.key.length);
    return ret;
  },
 
  // set up the line enc/dec keys
  openline:function(from, open)
  {
    from.lineIV = 0;
    from.lineInB = new Buffer(from.lineIn, "hex");
    var ecdhe = from.ecc.deriveSharedSecret(open.linepub);
    from.encKey = crypto.createHash("sha1")
      .update(ecdhe)
      .update(new Buffer(from.lineOut, "hex"))
      .update(from.lineInB)
      .digest().slice(0,16);
    from.decKey = crypto.createHash("sha1")
      .update(ecdhe)
      .update(from.lineInB)
      .update(new Buffer(from.lineOut, "hex"))
      .digest().slice(0,16);
    return true;
  },

  lineize:function(to, packet)
  {
  	// now encrypt the packet
    var iv = new Buffer(4);
    iv.writeUInt32LE(to.lineIV++,0);
    var ivz = new Buffer(12);
    ivz.fill(0);
    var aes = crypto.createCipheriv("AES-128-CTR", to.encKey, Buffer.concat([ivz,iv]));
    var cbody = Buffer.concat([aes.update(pencode(packet.js,packet.body)), aes.final()]);

    // prepend the IV and hmac it
    var mac = crypto.createHmac('sha1', to.encKey).update(Buffer.concat([iv,cbody])).digest()
  
    // create final body
    var body = Buffer.concat([to.lineInB,mac.slice(0,4),iv,cbody]);

    return pencode(null, body);
  },

  delineize:function(from, packet)
  {
    if(!packet.body) return "no body";
    // remove lineid
    packet.body = packet.body.slice(16);
    
    // validate the hmac
    var mac1 = packet.body.slice(0,4).toString("hex");
    var mac2 = crypto.createHmac('sha1', from.decKey).update(packet.body.slice(4)).digest().slice(0,4).toString("hex");
    if(mac1 != mac2) return "invalid hmac";

    // decrypt body
    var iv = packet.body.slice(4,8);
    var ivz = new Buffer(12);
    ivz.fill(0);
    var body = packet.body.slice(8);
    var aes = crypto.createDecipheriv("AES-128-CTR", from.decKey, Buffer.concat([ivz,iv]));
    var deciphered = pdecode(Buffer.concat([aes.update(body), aes.final()]));
  	if(!deciphered) return "invalid decrypted packet";

    packet.js = deciphered.js;
    packet.body = deciphered.body;
    return false;
  }
}

CS["2a"] = {
  genkey:function(ret,cbDone,cbStep)
  {
    var kpair = ursa.generatePrivateKey();
    ret["2a"] = str2der(kpair.toPublicPem("utf8")).toString("base64");
    ret["2a_secret"] = str2der(kpair.toPrivatePem("utf8")).toString("base64");
    ret.parts["2a"] = crypto.createHash("SHA256").update(str2der(kpair.toPublicPem("utf8"))).digest("hex");
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

  openize:function(id, to, inner)
  {
  	if(!to.ecc) to.ecc = new ecc.ECKey(ecc.ECCurves.nistp256);
    var eccpub = to.ecc.PublicKey.slice(1);

  	// encrypt the body
  	var ibody = pencode(inner, id.cs["2a"].key);
    var keyhex = crypto.createHash("sha256").update(eccpub).digest("hex");
    var key = new sjcl.cipher.aes(sjcl.codec.hex.toBits(keyhex));
    var iv = sjcl.codec.hex.toBits("00000000000000000000000000000001");
    var cipher = sjcl.mode.gcm.encrypt(key, sjcl.codec.hex.toBits(ibody.toString("hex")), iv, [], 128);
    var cbody = new Buffer(sjcl.codec.hex.fromBits(cipher), "hex");

  	// sign & encrypt the sig
    var sig = id.cs["2a"].private.hashAndSign("sha256", cbody, undefined, undefined, ursa.RSA_PKCS1_PADDING);
    var keyhex = crypto.createHash("sha256").update(Buffer.concat([eccpub,new Buffer(to.lineOut,"hex")])).digest("hex");
    var key = new sjcl.cipher.aes(sjcl.codec.hex.toBits(keyhex));
    var cipher = sjcl.mode.gcm.encrypt(key, sjcl.codec.hex.toBits(sig.toString("hex")), iv, [], 32);
    var csig = new Buffer(sjcl.codec.hex.fromBits(cipher), "hex");

  	// encrypt the ecc key
    var ekey = to.public.encrypt(eccpub, undefined, undefined, ursa.RSA_PKCS1_OAEP_PADDING);

    var body = Buffer.concat([ekey,csig,cbody]);    
    //	console.log(open, body.length);
  	var packet = pencode(0x2a, body);
  	return packet;
  },

  deopenize:function(id, open)
  {
    var ret = {verify:false};
    // grab the chunks
    var ekey = open.body.slice(0,256);
    var csig = open.body.slice(256,256+260);
    var cbody = open.body.slice(256+260);

    // decrypt the ecc public key and verify/load it
    try{
      var eccpub = id.cs["2a"].private.decrypt(ekey, undefined, undefined, ursa.RSA_PKCS1_OAEP_PADDING);
    }catch(E){
      err = E;
    }
    if(!eccpub) return ret;
    try {
      ret.linepub = new ecc.ECKey(ecc.ECCurves.nistp256, Buffer.concat([new Buffer("04","hex"),eccpub]), true);
    }catch(E){};
    if(!ret.linepub) return ret;

    // decipher the body as a packet so we can examine it
    var keyhex = crypto.createHash("sha256").update(eccpub).digest("hex");
    var key = new sjcl.cipher.aes(sjcl.codec.hex.toBits(keyhex));
    var iv = sjcl.codec.hex.toBits("00000000000000000000000000000001");
    var cipher = sjcl.mode.gcm.decrypt(key, sjcl.codec.hex.toBits(cbody.toString("hex")), iv, [], 128);
    var ibody = new Buffer(sjcl.codec.hex.fromBits(cipher), "hex");
    var deciphered = pdecode(ibody);
    if(!deciphered || !deciphered.body) return ret;
    ret.js = deciphered.js;
    ret.key = deciphered.body;

    // extract attached public key
  	var ukey = ursa.coercePublicKey(der2pem(deciphered.body,"PUBLIC"));
    if(!ukey) return ret;
    if(ukey.getModulus().length < 256) return ret;

    // decrypt signature
    var keyhex = crypto.createHash("sha256").update(Buffer.concat([eccpub,new Buffer(deciphered.js.line,"hex")])).digest("hex");
    var key = new sjcl.cipher.aes(sjcl.codec.hex.toBits(keyhex));
    var cipher = sjcl.mode.gcm.decrypt(key, sjcl.codec.hex.toBits(csig.toString("hex")), iv, [], 32);
    var sig = new Buffer(sjcl.codec.hex.fromBits(cipher), "hex");

    // verify signature
    try{
      ret.verify = ukey.hashAndVerify("sha256", cbody, sig, undefined, ursa.RSA_PKCS1_PADDING);
    }catch(E){
//      console.log("verify failed",E);
    }
    return ret;
  },

  // set up the line enc/dec keys
  openline:function(from, open)
  {
    var ecdhe = from.ecc.deriveSharedSecret(open.linepub);
    from.lineInB = new Buffer(from.lineIn, "hex");
    var hex = crypto.createHash("sha256")
      .update(ecdhe)
      .update(new Buffer(from.lineOut, "hex"))
      .update(new Buffer(from.lineIn, "hex"))
      .digest("hex");
    from.encKey = new sjcl.cipher.aes(sjcl.codec.hex.toBits(hex));
    var hex = crypto.createHash("sha256")
      .update(ecdhe)
      .update(new Buffer(from.lineIn, "hex"))
      .update(new Buffer(from.lineOut, "hex"))
      .digest("hex");
    from.decKey = new sjcl.cipher.aes(sjcl.codec.hex.toBits(hex));
    return true;
  },

  lineize:function(to, packet)
  {
    var iv = crypto.randomBytes(16);
    var buf = pencode(packet.js,packet.body);

  	// now encrypt the packet
    var cipher = sjcl.mode.gcm.encrypt(to.encKey, sjcl.codec.hex.toBits(buf.toString("hex")), sjcl.codec.hex.toBits(iv.toString("hex")), [], 128);
    var cbody = new Buffer(sjcl.codec.hex.fromBits(cipher),"hex");

    var body = Buffer.concat([to.lineInB,iv,cbody]);
  	return pencode(null,body);
  },

  delineize:function(from, packet)
  {
    if(!packet.body) return "missing body";
    // remove lineid
    packet.body = packet.body.slice(16);
    var iv = sjcl.codec.hex.toBits(packet.body.slice(0,16).toString("hex"));
  
    try{
      var cipher = sjcl.mode.gcm.decrypt(from.decKey, sjcl.codec.hex.toBits(packet.body.slice(16).toString("hex")), iv, [], 128);    
    }catch(E){
      return E;
    }
    if(!cipher) return "no cipher output";
    var deciphered = pdecode(new Buffer(sjcl.codec.hex.fromBits(cipher),"hex"));
  	if(!deciphered) return "invalid decrypted packet";

    packet.js = deciphered.js;
    packet.body = deciphered.body;
    return false;
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

CS["3a"] = {
  genkey:function(ret,cbDone,cbStep)
  {
    var kp = sodium.crypto_box_keypair();
    ret["3a"] = kp.publicKey.toString("base64");
    ret["3a_secret"] = kp.secretKey.toString("base64");
    ret.parts["3a"] = crypto.createHash("SHA256").update(kp.publicKey).digest("hex");
    cbDone();
  },

  loadkey:function(id, pub, priv)
  {
    if(typeof pub == "string") pub = new Buffer(pub,"base64");
    if(!Buffer.isBuffer(pub) || pub.length != 32) return "invalid public key";
    id.key = pub;
    id.public = pub;

    if(priv)
    {
      if(typeof priv == "string") priv = new Buffer(priv,"base64");
      if(!Buffer.isBuffer(priv) || priv.length != 32) return "invalid private key";
      id.private = priv;
    }
    return false;
  },
  
  openize:function(id, to, inner)
  {
  	if(!to.linekey) to.linekey = sodium.crypto_box_keypair();
    var linepub = to.linekey.publicKey;

    // get the shared secret to create the iv+key for the open aes
    var secret = sodium.crypto_box_beforenm(to.public, to.linekey.secretKey);
    var nonce = new Buffer("000000000000000000000000000000000000000000000001","hex");

    // encrypt the inner
    var body = pencode(inner,id.cs["3a"].key);
    var cbody = sodium.crypto_secretbox(body, nonce, secret);
  
    // prepend the line public key and hmac it  
    var secret = sodium.crypto_box_beforenm(to.public, id.cs["3a"].private);
    var macd = Buffer.concat([linepub,cbody]);
    var mac = sodium.crypto_onetimeauth(macd,secret);
  
    // create final body
    var body = Buffer.concat([mac,macd]);
    return pencode(0x3a, body);
  },
  
  deopenize:function(id, open)
  {
    var ret = {verify:false};
    if(!open.body) return ret;

    var mac1 = open.body.slice(0,16).toString("hex");
    ret.linepub = open.body.slice(16,48);
    var cbody = open.body.slice(48);

    var secret = sodium.crypto_box_beforenm(ret.linepub,id.cs["3a"].private);
    var nonce = new Buffer("000000000000000000000000000000000000000000000001","hex");

    // decipher the inner
    var body = sodium.crypto_secretbox_open(cbody,nonce,secret);
    var inner = pdecode(body);
    if(!inner) return ret;

    // load inner key info
    ret.key = inner.body;
    if(!ret.key || ret.key.length != 32) return ret;
    if(typeof inner.js.from != "object" || !inner.js.from["3a"]) return ret;
    if(crypto.createHash("SHA256").update(inner.body).digest("hex") != inner.js.from["3a"]) return ret;

    // verify the hmac
    var secret = sodium.crypto_box_beforenm(ret.key, id.cs["3a"].private);
    var mac2 = sodium.crypto_onetimeauth(open.body.slice(16),secret).toString("hex");
    if(mac2 != mac1) return ret;
  
    // all good, cache+return
    ret.verify = true;
    ret.js = inner.js;
//    console.log("INNER",inner.js,ret.key.length);
    return ret;
  },
 
  // set up the line enc/dec keys
  openline:function(from, open)
  {
    from.lineIV = 0;
    from.lineInB = new Buffer(from.lineIn, "hex");
    var secret = sodium.crypto_box_beforenm(open.linepub, from.linekey.secretKey);
    from.encKey = crypto.createHash("sha256")
      .update(secret)
      .update(new Buffer(from.lineOut, "hex"))
      .update(new Buffer(from.lineIn, "hex"))
      .digest();
    from.decKey = crypto.createHash("sha256")
      .update(secret)
      .update(new Buffer(from.lineIn, "hex"))
      .update(new Buffer(from.lineOut, "hex"))
      .digest();
    return true;
  },

  lineize:function(to, packet)
  {
  	// now encrypt the packet
    var nonce = crypto.randomBytes(24);
    var cbody = sodium.crypto_secretbox(pencode(packet.js,packet.body), nonce, to.encKey);

    // create final body
    var body = Buffer.concat([to.lineInB,nonce,cbody]);

    return pencode(null, body);
  },

  delineize:function(from, packet)
  {
    if(!packet.body) return "no body";
    // remove lineid
    packet.body = packet.body.slice(16);
    
    // decrypt body
    var nonce = packet.body.slice(0,24);
    var cbody = packet.body.slice(24);
    var deciphered = pdecode(sodium.crypto_secretbox_open(cbody,nonce,from.decKey));
  	if(!deciphered) return "invalid decrypted packet";

    packet.js = deciphered.js;
    packet.body = deciphered.body;
    return false;
  }
}

function parts2hn(parts)
{
  var rollup = new Buffer(0);
  Object.keys(parts).sort().forEach(function(id){
    rollup = crypto.createHash("sha256").update(Buffer.concat([rollup,new Buffer(id)])).digest();
    rollup = crypto.createHash("sha256").update(Buffer.concat([rollup,new Buffer(parts[id])])).digest();
  });
  return rollup.toString("hex");
}

function lineid(buf)
{
  if(!buf) return "";
  return buf.slice(0,16).toString("hex");
}

function hashHEX(buf)
{
  if(!buf) return "";
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// return random bytes, in hex
function randomHEX(len)
{
	return crypto.randomBytes(len).toString("hex");
}

// encode a packet
function pencode(js, body)
{
  var head = (typeof js == "number") ? new Buffer(String.fromCharCode(js)) : new Buffer(js?JSON.stringify(js):"", "utf8");
  if(typeof body == "string") body = new Buffer(body, "binary");
  body = body || new Buffer(0);
  var len = new Buffer(2);
  len.writeInt16BE(head.length, 0);
  return Buffer.concat([len, head, body]);
}

// packet decoding
function pdecode(packet)
{
  if(!packet) return undefined;
  var buf = (typeof packet == "string") ? new Buffer(packet, "binary") : packet;

  // read and validate the json length
  var len = buf.readUInt16BE(0);
  if(len > (buf.length - 2)) return undefined;
  var head = buf.slice(2, len+2);
  var body = buf.slice(len + 2);

  // parse out the json
  var js = {};
  if(len > 1)
  {
    try {
      js = JSON.parse(head.toString("utf8"));
    } catch(E) {
      console.log("couldn't parse JS",head.toString("hex"),E,packet.sender);
      return undefined;
    }
  }
  return {js:js, length:buf.length, head:head.toString("binary"), body:body};
}