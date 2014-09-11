var expect = require('chai').expect;
var telehash = require('../node.js');
telehash.log({debug:console.log});
describe('node-telehash', function(){

  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};

  it('should export an object', function(){
    expect(telehash).to.be.a('object');
  });

  it('should have extensions', function(){
    expect(Object.keys(telehash.extensions).length).to.be.equal(1);
  });
  
  it('should create a real mesh', function(done){
    telehash.mesh({id:idA},function(err, mesh){
      expect(err).to.not.exist;
      expect(mesh).to.be.an('object');
      expect(mesh.extended.length).to.be.equal(2);
      expect(mesh.paths().length).to.be.equal(1);
      done();
    });
  });


});
