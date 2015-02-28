var expect = require('chai').expect;
var concat = require('concat-stream');
var httplib = require('http');
var telehash = require('../../lib/mesh.js');
var lob = require('lob-enc');
var chat = require('../../ext/chat.js');
var stream = require('../../ext/stream.js');

describe('telehash/chat', function(){
  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an extension', function(){
    expect(chat).to.be.a('object');
    expect(chat.name).to.be.equal('chat');
  });

  it('should create a new extension', function(done){
    var mesh = {};
    chat.mesh(mesh, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(mesh.chat).to.be.a('function');
      done();
    });
  });

  it('should siphash', function(){
    var hash = telehash.hashname.siphash('fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq','message');
    expect(hash.toString('hex')).to.be.equal('49054fd70340c22d');
  });

  it('should create a new leader chat', function(done){
    // mock mesh
    var mesh = {hashname:'fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq', lib:telehash, log:{debug:console.log}};
    chat.mesh(mesh, function(err, ext){
      mesh.chat({json:{}}, function(err, chat){
        expect(err).to.not.exist;
        expect(chat).to.be.a('object');
        expect(chat.id).to.be.a('string');
        expect(chat.profiles).to.be.a('object');
        expect(chat.profiles[mesh.hashname]).to.be.a('object');
        expect(chat.profiles[mesh.hashname].json.id).to.be.equal(chat.id);
        done();
      });
    });
  });

  it('should establish a 1:1 chat', function(done){
    telehash.log({debug:console.log});
    telehash.mesh({id:idA,extensions:{chat:chat,stream:stream}},function(err, meshA){
      expect(err).to.not.exist;
      telehash.mesh({id:idB,extensions:{chat:chat,stream:stream}},function(err, meshB){
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

          // they're linked, set up invite handler on B
          meshB.invited(function(link, profile){
            console.log('INVITED',profile.json);
            // auto-accept it
            meshB.chat({leader:link,id:profile.json.id},{json:{}},function(err){
              expect(err).to.not.exist;
              done();
            });
          });

          // initiate chat from A->B
          meshA.chat({json:{}}, function(err, chat){
            expect(err).to.not.exist;
            chat.join(linkAB);
            chat.inbox.on('data', function(msg){
              console.log('CHAT JOIN',msg.json);
              expect(msg.json.type).to.exist;
            });
            
          });
        });
        var linkBA = meshB.link({keys:idA.keys});
        linkBA.addPipe(pipeBA);
        expect(linkBA).to.exist;
      });
    });
  });

  it('should echo messages', function(done){
    telehash.log({debug:console.log});
    telehash.mesh({id:idA,extensions:{chat:chat,stream:stream}},function(err, meshA){
      expect(err).to.not.exist;
      telehash.mesh({id:idB,extensions:{chat:chat,stream:stream}},function(err, meshB){
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

          // they're linked, set up invite handler on B
          meshB.invited(function(link, profile){
            console.log('INVITED',profile.json);
            // auto-accept it
            meshB.chat({leader:link,id:profile.json.id},'B B',function(err, chat){
              expect(err).to.not.exist;
              chat.inbox.on('data', function(msg){
                console.log('ECHOB',msg.json);
                if(msg.from == meshA.hashname && msg.json.type == 'chat') chat.send(msg.json.text);
              });
            });
          });

          // initiate chat from A->B
          meshA.chat('A A',function(err, chat){
            expect(err).to.not.exist;
            chat.join(linkAB);
            chat.inbox.on('data', function(msg){
              console.log('ECHOA',msg.from,msg.json);
              if(msg.json.from == meshB.hashname && msg.json.type == 'join')
              {
                chat.outbox.write('echo');
              }
              if(msg.from == meshB.hashname && msg.json.text == 'echo') done();
            });
            
          });
        });
        var linkBA = meshB.link({keys:idA.keys});
        linkBA.addPipe(pipeBA);
        expect(linkBA).to.exist;
      });
    });
  });
});
