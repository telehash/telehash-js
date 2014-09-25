var expect = require('chai').expect;
var concat = require('concat-stream');
var fs = require('fs');
var telehash = require('../../telehash.js');
var stream = require('../../lib/stream.js');

describe('telehash/stream', function(){

  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an extension', function(){
    expect(stream).to.be.a('object');
    expect(stream.name).to.be.equal('stream');
    expect(stream.mesh).to.be.a('function');
  });

  it('should create a new extension', function(){
    stream.mesh({}, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(ext.open).to.be.a('object');
      expect(ext.open.stream).to.be.a('function');
      expect(ext.link).to.be.a('function');
    });
  });

  it('should stream itself between two', function(done){
    telehash.log({debug:console.log});
    var meshA = telehash.mesh({id:idA,extensions:{stream:stream}});
    expect(meshA).to.exist;
    var meshB = telehash.mesh({id:idB,extensions:{stream:stream}});
    expect(meshB).to.exist;
    
    // pair them
    meshA.mesh(meshB);
    var linkAB = meshA.link(meshB.hashname);
    
    // accept and concat stream
    meshB.stream(function(link, req, accept){
      expect(link).to.exist;
      accept().pipe(concat(function(me){
        console.log('MEMEME',me);
        done();
      }));
    })
    
    // send stream
    fs.createReadStream(__filename).pipe(linkAB.stream());

  });

});
