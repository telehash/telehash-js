var expect = require('chai').expect;
var telehash = require('../../telehash.js');
var lob = require('lob-enc');
var peer = require('../../lib/peer.js');

describe('telehash/peer', function(){
  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an extension', function(){
    expect(peer).to.be.a('object');
    expect(peer.name).to.be.equal('peer');
    expect(peer.mesh).to.be.a('function');
  });

  it('should create a peer pipe', function(done){
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      mesh.extend(peer, function(err){
        expect(err).to.not.exist;
        var link = mesh.link({keys:idB.keys});
        link.addPath({type:'peer',hn:link.hashname},function(pipe){
          expect(pipe).to.be.an('object');
          expect(pipe.isPipe).to.be.true;
          expect(link.pipes.length).to.be.equal(1);
          done();
        });
      });
    });
  });

});
