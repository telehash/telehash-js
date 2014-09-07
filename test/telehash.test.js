var expect = require('chai').expect;
var telehash = require('../telehash.js');

describe('telehash', function(){

  var idA = {"keys":{"1a":"0ecv95ajma11pg3uwauzhh9t8mnx5wzxhw"},"secrets":{"1a":"vkuu5mm3njjg4v7j4f3mx5hkd9dzbevu"},"hashname":"hdaybn855322qnwyrrgpzvckqffuf8xqz6tqy338t560qgk2v45g"};
  var idB = {"keys":{"1a":"0b5076hpzgud3mgca1y04nfayt2p3np8tg"},"secrets":{"1a":"k03b22mb4vj4cf57w31e646ygj35cbmp"},"hashname":"uvgehzf7yh1t8e656b4c4x17xzh5ngmvz8ww49zk9cabufzn3g7g"};

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
    telehash.mesh({id:idA},function(err, mesh){
      expect(err).to.not.exist;
      expect(mesh).to.be.an('object');
      expect(mesh.hashname).to.be.equal('hdaybn855322qnwyrrgpzvckqffuf8xqz6tqy338t560qgk2v45g');
      expect(mesh.router).to.be.a('function');
      expect(mesh.route).to.be.a('function');
      expect(mesh.link).to.be.a('function');
      expect(mesh.discover).to.be.a('function');
      done();
    });
  });

  it('should create a link', function(done){
    telehash.mesh({id:idA},function(err, mesh){
      var link = mesh.link({keys:idB.keys});
      expect(link).to.be.an('object');
      expect(link.hashname).to.be.equal('uvgehzf7yh1t8e656b4c4x17xzh5ngmvz8ww49zk9cabufzn3g7g');
      expect(link.router).to.be.a('function');
      expect(link.route).to.be.a('function');
      done();
    });
  });

  it('should return an exchange', function(done){
    telehash.mesh({id:idA},function(err, mesh){
      var link = mesh.link({keys:idB.keys});
      var x = mesh.x(link.hashname);
      expect(x).to.be.an('object');
      expect(Array.isArray(x.pipes)).to.be.true;
      done();
    });
  });

  it('should create a peer pipe', function(done){
    telehash.mesh({id:idA},function(err, mesh){
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
    telehash.mesh({id:idA},function(err, mesh){
      mesh.extend(ext);
    });
  });

  it('should create a pipe to a transport', function(done){
    var ptest = {type:'test',test:true};
    var ext = {name:'test',mesh:function(mesh,cbExt){
      cbExt(undefined,{pipe:function(hn,path,cbPipe){
        expect(hn).to.be.equal('uvgehzf7yh1t8e656b4c4x17xzh5ngmvz8ww49zk9cabufzn3g7g');
        expect(path).to.be.equal(ptest);
        cbPipe(new telehash.Pipe('test'));
      }});
    }};
    telehash.mesh({id:idA},function(err, mesh){
      mesh.extend(ext,function(err){
        expect(err).to.not.exist;
        mesh.pipe(idB.hashname,ptest,function(pipe){
          expect(pipe.type).to.be.equal('test');
          done();
        });
      });
    });
  });

});
