test:
	./node_modules/.bin/mocha --reporter list test/*.test.js test/**/*.test.js -t 10000

.PHONY: test
