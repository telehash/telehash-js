// this loads the pure-javascript crypto bindings used by thjs

exports.load = function(){
  // TODO get these ported to forge or packaged better or something, so brute force!
  var window = GLOBAL;
  var navigator = GLOBAL;
  var eccinc = ["jsbn.js","jsbn2.js","ec.js","sec.js","prng4.js","rng.js"];
  for(var i in eccinc) try{
    var inc = require("path").join(__dirname,"/node_modules/thjs/includes/",eccinc[i]);
    eval(require("fs").readFileSync(inc).toString()); }catch(E){ console.log(inc,E);
  }
  global.getSECCurveByName = getSECCurveByName;
  global.BigInteger = BigInteger;
  global.SecureRandom = SecureRandom;
  global.ECPointFp = ECPointFp;
  var thforge = require("thjs/thforge");
  thforge.forge(require("node-forge"));
  thforge.sjcl(require("sjcl"));
  return thforge;
}


