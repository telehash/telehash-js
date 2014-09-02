var expect = require('chai').expect;
var telehash = require('../telehash.js');

describe('telehash', function(){

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

  it('should support adding extensions', function(){
    expect(telehash.add({name:'test'})).to.be.true;
  });

  it('should generate', function(done){
    telehash.generate(function(err, secrets){
      expect(err).to.not.exist;
      expect(secrets).to.be.an('object');
      done();
    });
  });

  it('should support logging', function(done){
    telehash.log({debug:function(msg){
      expect(msg).to.exist;
      done();
    }});
    // just run something that logs
    telehash.generate(function(err, secrets){});
  });

});
