
var gulp = require('gulp');
var mocha = require('gulp-mocha');
var watch = require('gulp-watch')
var chext = require("chext");
var jsdoc = require("gulp-jsdoc");

var unitTests = [ 'test/index.test.js'
                , 'test/ext/box.test.js'
                , 'test/ext/chat.test.js'
                , 'test/ext/path.test.js'
                , 'test/ext/peer.test.js'
                , 'test/ext/stream.test.js'
                , 'test/ext/thtp.test.js'
                , 'test/lib/mesh.test.js'
                , 'test/lib/pipe.test.js'
                , 'test/lib/uri.test.js'];

var srcFiles = ['index.js', 'ext/*.js', 'lib/*.js']


gulp.task('mocha', function() {
  return  gulp.src( unitTests, { read: false })
              .pipe(mocha({ reporter: 'list' }))
              .on('error', function(){
              })
              .on('end', function(){

              });
});

gulp.task('dev', ['mocha'], function() {
  var ch = new chext()

  ch.watchify(unitTests)

  ch.on("testing_complete",function(results){
    console.log("tests complete", results)
  })

  gulp.watch(unitTests.concat(srcFiles), ["mocha"])
})

gulp.task('doc', function(){
  gulp.src(["./lib/*.js", "./ext/*.js"])
  .pipe(jsdoc('./doc'))
})

gulp.task('doc-watch', function(){

  gulp.watch(srcFiles, ["doc"])
})
