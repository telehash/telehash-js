// this loads the pure-javascript crypto bindings used by thjs

exports.load = function(){
  // TODO get these ported to forge or packaged better or something, so brute force!
  var window = GLOBAL;
  var navigator = GLOBAL;
  var eccinc = ["jsbn.js","jsbn2.js","ec.js","sec.js","prng4.js","rng.js"];
  for(var i in eccinc) try{ eval(require("fs").readFileSync(__dirname+"/node_modules/thjs/includes/"+eccinc[i]).toString()); }catch(E){ console.log(inc,E); }
  global.getSECCurveByName = getSECCurveByName;
  global.BigInteger = BigInteger;
  global.SecureRandom = SecureRandom;
  global.ECPointFp = ECPointFp;
  return require("thjs/thforge").forge(require("node-forge"));
}


