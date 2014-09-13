var expect = require('chai').expect;
var telehash = require('../telehash.js');

describe('telehash', function(){
  var idA = {"keys":{"1a":"akndnx5kbansip6xphxymwckpqkjj26fcm"},"secrets":{"1a":"ksxslm5mmtymnbph7nvxergb7oy3r35u"},"hashname":"5uegloufcyvnf34jausszmsabbfbcrg6fyxpcqzhddqxeefuapvq"};
  var idB = {"keys":{"1a":"apkoh54rkobkeela6d62hblhqd7grqd5dm"},"secrets":{"1a":"ljfm3ov42x2fl6gsg6bxiqgtstnxls7r"},"hashname":"fvifxlr3bsaan2jajo5qqn4au5ldy2ypiweazmuwjtgtg43tirkq"};

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
//      console.log('idA',JSON.stringify(id));
      done();
    });
  });

  it('should create a mesh', function(done){
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      expect(err).to.not.exist;
      expect(mesh).to.be.an('object');
      expect(mesh.hashname).to.be.equal(idA.hashname);
      expect(mesh.router).to.be.a('function');
      expect(mesh.route).to.be.a('function');
      expect(mesh.link).to.be.a('function');
      expect(mesh.discover).to.be.a('function');
      done();
    });
  });

  it('should create a link', function(done){
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      var link = mesh.link({keys:idB.keys});
      expect(link).to.be.an('object');
      expect(link.hashname).to.be.equal(idB.hashname);
      expect(link.router).to.be.a('function');
      expect(link.route).to.be.a('function');
      done();
    });
  });

  it('should return an exchange', function(done){
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      var link = mesh.link({keys:idB.keys});
      var x = mesh.x(link.hashname);
      expect(x).to.be.an('object');
      expect(x.sending).to.be.a('function');
      done();
    });
  });

  it('should create a peer pipe', function(done){
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      var link = mesh.link({keys:idB.keys});
      mesh.pipe(link.hashname,{type:'peer',hn:link.hashname},function(pipe){
        expect(pipe).to.be.an('object');
        expect(pipe.isPipe).to.be.true;
        expect(Array.isArray(mesh.pipes[link.hashname])).to.be.true;
        expect(mesh.pipes[link.hashname].length).to.be.equal(1);
        done();
      });
    });
  });

  it('should create a transport', function(done){
    var ext = {name:'test',mesh:function(mesh){
      expect(mesh).to.be.an('object');
      done();
    }};
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      mesh.extend(ext);
    });
  });

  it('should enable discovery', function(done){
    var ext = {name:'test',mesh:function(mesh,cb){
      cb(undefined,{discover:function(opts){
        expect(opts).to.be.an('object');
        done();
      }});
    }};
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      mesh.extend(ext, function(){
        mesh.discover({},function(){});
      });
    });
  });

  it('should create a pipe to a transport', function(done){
    var ptest = {type:'test',test:true};
    var ext = {name:'test',mesh:function(mesh,cbExt){
      cbExt(undefined,{pipe:function(hn,path,cbPipe){
        expect(hn).to.be.equal(idB.hashname);
        expect(path).to.be.equal(ptest);
        cbPipe(new telehash.Pipe('test'));
      }});
    }};
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      mesh.extend(ext,function(err){
        expect(err).to.not.exist;
        mesh.pipe(idB.hashname,ptest,function(pipe){
          expect(pipe.type).to.be.equal('test');
          done();
        });
      });
    });
  });

  it('should generate a keepalive', function(done){
    var ext = {name:'test',mesh:function(mesh,cbExt){
      cbExt(undefined,{pipe:function(hn,path,cbPipe){
        var pipe = new telehash.Pipe('test');
        pipe.onSend = function(packet){
          expect(Buffer.isBuffer(packet)).to.be.true;
          expect(packet.length).to.be.equal(72);
          done();
        };
        cbPipe(pipe);
      }});
    }};
    telehash.mesh({id:idA,extensions:{}},function(err, mesh){
      mesh.extend(ext,function(){
        var link = mesh.link({keys:idB.keys});
        mesh.pipe(link.hashname,{type:'test'});
      });
    });
  });

});
