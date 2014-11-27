var expect = require('chai').expect;
var telehash = require('..');
telehash.log({debug:console.log});
describe('telehash-js', function(){

  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

  it('should have extensions', function(){
    expect(Object.keys(telehash.extensions).length).to.be.above(3);
  });
  
  it('should create a real mesh', function(done){
    telehash.mesh({id:idA},function(err, mesh){
      expect(err).to.not.exist;
      expect(mesh).to.be.an('object');
      expect(mesh.extended.length).to.be.equal(7);
      expect(mesh.paths().length).to.be.above(0);
      expect(mesh.discover({discover:function(){}},function(err){
        expect(err).to.not.exist;
        done();
      }));
    });
  });

  it('should create a real link', function(done){
    telehash.mesh({id:idA},function(err, meshA){
      expect(err).to.not.exist;
      var linkAB = meshA.link({keys:idB.keys});
      expect(linkAB).to.exist;
      telehash.mesh({id:idB},function(err, meshB){
        expect(err).to.not.exist;
        var linkBA = meshB.link({keys:idA.keys,paths:meshA.paths()});
        expect(linkAB).to.exist;
        linkBA.status(function(err){
          expect(err).to.not.exist;
          done();
        });
      });
    });
  });


});
