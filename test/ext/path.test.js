var expect = require('chai').expect;
var telehash = require('../../lib/mesh.js');
var lob = require('lob-enc');
var path = require('../../ext/path.js');

describe('telehash/path', function(){
  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an extension', function(){
    expect(path).to.be.a('object');
    expect(path.name).to.be.equal('path');
    expect(path.mesh).to.be.a('function');
  });

  it('should create a new extension', function(){
    path.mesh({}, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(ext.open).to.be.a('object');
      expect(ext.open.path).to.be.a('function');
      expect(ext.link).to.be.a('function');
    });
  });

  it('should ping up a full link', function(done){
    telehash.log({debug:console.log});
    telehash.mesh({id:idA,extensions:{path:path}},function(err, meshA){
      expect(err).to.not.exist;
      telehash.mesh({id:idB,extensions:{path:path}},function(err, meshB){
        expect(err).to.not.exist;

        // create virtual pipes
        var pipeAB = new telehash.Pipe('test');
        var pipeBA = new telehash.Pipe('test');
        pipeAB.onSend = function(packet){meshB.receive(packet,pipeBA)};
        pipeBA.onSend = function(packet){meshA.receive(packet,pipeAB)};

        var linkAB = meshA.link({keys:idB.keys});
        linkAB.addPipe(pipeAB);
        expect(linkAB).to.exist;
        linkAB.status(function(err){
          expect(err).to.not.exist;
          linkAB.ping(function(err, time){
            expect(err).to.not.exist;
            expect(time).to.be.a('number');
            done();
          });
        });
        var linkBA = meshB.link({keys:idA.keys});
        linkBA.addPipe(pipeBA);
        expect(linkBA).to.exist;
      });
    });
  });


});
