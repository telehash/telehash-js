var expect = require('chai').expect;
var concat = require('concat-stream');
var httplib = require('http');
var telehash = require('../../lib/mesh.js');
var lob = require('lob-enc');
var stream = require('../../ext/stream.js');
var thtp = require('../../ext/thtp.js');

describe('telehash/thtp', function(){
  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

  it('should export an extension', function(){
    expect(thtp).to.be.a('object');
    expect(thtp.name).to.be.equal('thtp');
    expect(thtp.mesh).to.be.a('function');
  });

  it('should create a new extension', function(done){
    var mesh = {};
    thtp.mesh(mesh, function(err, ext){
      expect(err).to.not.exist;
      expect(ext).to.be.a('object');
      expect(ext.link).to.be.a('function');
      expect(mesh.proxy).to.be.a('function');
      expect(mesh.request).to.be.a('function');
      var link = {};
      ext.link(link, function(err){
        expect(err).to.not.exist;
        expect(link.proxy).to.be.a('function');
        expect(link.request).to.be.a('function');
        done();
      })
    });
  });

  it('should receive an internal proxy request', function(done){
//    telehash.log({debug:console.log});
    var meshA = telehash.mesh({id:idA,extensions:{stream:stream,thtp:thtp}});
    expect(meshA).to.exist;
    var meshB = telehash.mesh({id:idB,extensions:{stream:stream,thtp:thtp}});
    expect(meshB).to.exist;
    
    // pair them
    meshA.mesh(meshB);
    var linkAB = meshA.link(meshB.hashname);
    
    // dummy proxy
    var proxy = {emit:function(on, req, res){
      expect(on).to.be.equal('request');
      expect(req.method).to.be.equal('POST');
      expect(req.url).to.be.equal('/');
      req.pipe(concat(function(body){
        expect(body).to.exist;
        expect(body.toString()).to.be.equal('test');
        done();
      }));
    }};
    meshB.proxy(proxy);
    
    // send request
    linkAB.request({method:'post',path:'/'}, function(err){
      expect(err).to.not.exist;
    }).end('test');

  });

  it('should proxy to a real server', function(done){
//    telehash.log({debug:console.log});
    var meshA = telehash.mesh({id:idA,extensions:{stream:stream,thtp:thtp}});
    expect(meshA).to.exist;
    var meshB = telehash.mesh({id:idB,extensions:{stream:stream,thtp:thtp}});
    expect(meshB).to.exist;
    
    // pair them
    meshA.mesh(meshB);
    var linkAB = meshA.link(meshB.hashname);
    
    // dummy proxy
    var proxy = httplib.createServer(function(req, res){
      expect(req.url).to.be.equal('/test');
      res.end('test');
    });
    meshB.proxy(proxy);
    
    // send request and gather response
    linkAB.request('/test', function(err, res){
      expect(err).to.not.exist;
      res.pipe(concat(function(body){
        expect(body.toString()).to.be.equal('test');
        done();
      }));
    });
  });

});
