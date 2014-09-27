// TEST
var expect = require('chai').expect;
var concat = require('concat-stream');
var es = require('event-stream');
var fs = require('fs');
var telehash = require('../../lib/mesh.js');
var stream = require('../../ext/stream.js');

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
        expect(me).to.exist;
        expect(me.toString().indexOf('// TEST')).to.be.equal(0);
        done();
      }));
    })
    
    // send stream
    fs.createReadStream(__filename).pipe(linkAB.stream()).on('error',done);

  });

  it('should stream bidi', function(done){
    telehash.log({debug:console.log});

    var meshA = telehash.mesh({id:idA,extensions:{stream:stream}});
    expect(meshA).to.exist;
    var meshB = telehash.mesh({id:idB,extensions:{stream:stream}});
    expect(meshB).to.exist;

    // accept and mirror stream
    meshB.stream(function(linkBA, req, accept){
      expect(linkBA).to.exist;
      var streamBA = accept();
      streamBA.pipe(streamBA); // mirror it back
    });
    
    // pair them
    meshA.mesh(meshB);
    
    // send stream
    var linkAB = meshA.link(meshB.hashname);
    var streamAB = linkAB.stream();
    // accept and concat stream
    streamAB.pipe(concat(function(me){
      expect(me).to.exist;
      expect(me.toString().indexOf('// TEST')).to.be.equal(0);
      done();
    }));

    // push test data (ourselves)
    fs.createReadStream(__filename).pipe(streamAB).on('error',done);

  });

  it('should stream objects', function(done){
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
      accept().pipe(es.writeArray(function(err,items){
        expect(err).to.not.exist;
        expect(items).to.exist;
        expect(items.length).to.be.equal(4);
        expect(items[0]).to.be.equal(1);
        expect(items[2]).to.be.equal(true);
        expect(items[3].all).to.be.equal(42);
        done();
      }));
    })
    var streamAB = linkAB.stream();
    
    // stream objects
    es.readArray([1,2,true,{all:42}]).pipe(streamAB).on('error',done);

  });

});
