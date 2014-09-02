var expect = require('chai').expect;
var telehash = require('../telehash.js');

describe('telehash', function(){

  var idA = {"keys":{"1a":"0ecv95ajma11pg3uwauzhh9t8mnx5wzxhw"},"secrets":{"1a":"vkuu5mm3njjg4v7j4f3mx5hkd9dzbevu"},"hashname":"hdaybn855322qnwyrrgpzvckqffuf8xqz6tqy338t560qgk2v45g"};

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

  it('should support adding extensions', function(){
    expect(telehash.add({name:'test'})).to.be.true;
  });

  it('should support logging', function(done){
    telehash.log({debug:function(msg){
      expect(msg).to.exist;
      // disable
      telehash.log({debug:function(){}});
      done();
    }});
    // just run something that logs
    telehash.generate(function(err, secrets){});
  });

  it('should generate', function(done){
    telehash.generate(function(err, id){
      expect(err).to.not.exist;
      expect(id).to.be.an('object');
      expect(id.hashname).to.be.a('string');
      expect(id.hashname.length).to.be.equal(52);
      console.log(JSON.stringify(id));
      done();
    });
  });

  it('should create a mesh', function(done){
    telehash.mesh({id:idA},function(err, mesh){
      expect(err).to.not.exist;
      expect(mesh).to.be.an('object');
      done();
    });
  });


});
