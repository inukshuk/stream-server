/* ***** BEGIN LICENSE BLOCK *****
    Copyright © 2015 Zotero
                     https://www.zotero.org

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

    ***** END LICENSE BLOCK *****
*/

'use strict';

var mockery = require('mockery');
var sinon = require('sinon');

var config = require('config');
var Promise = require('bluebird');
var fs = require('fs');
var requestAsync = Promise.promisify(require('request'));

mockery.registerSubstitute('./queue', './test/support/queue_mock');
mockery.enable();
mockery.warnOnUnregistered(false);

var zoteroAPI = require('../zotero_api');
var connections = require('../connections');
var queue = require('./support/queue_mock');
var WebSocket = require('./support/websocket');
var assertionCount = require('./support/assertion_count');
var assert = assertionCount.assert;
var expect = assertionCount.expect;
var testUtils = require('./support/test_utils');
var baseURL = testUtils.baseURL;
var onEvent = testUtils.onEvent;
var makeAPIKey = testUtils.makeAPIKey;

var zotero = require('zotero');

zotero.Stream.defaults.hostname = '127.0.0.1';
zotero.Stream.defaults.port = config.get('httpPort');
zotero.Stream.defaults.protocol = 'http';

// Start server
var defer = Promise.defer();
require('../server')(function () {
  defer.resolve();
});


describe('Streamer Tests:', function () {

  // Wait for server initialization
  // TODO: Emit an event for this
  before(function (done) {
    defer.promise.then(function () {
      done();
    });
  });

  beforeEach(assertionCount.reset);
  afterEach(assertionCount.check);

  //
  //
  // Single-key requests
  //
  //
  describe('Single-key event stream', function () {
    it('should connect', function (done) {
      (new zotero.Stream())
        .on('open', function () {
          this.close();
          done();
        });
    });

    it('should include a retry value', function (done) {
      (new zotero.Stream())
        .on('connected', function (data) {
          assert.equal(data.retry, config.get('retryTime') * 1000);

          this.close();
          done();
        });
    });

    it('should reject unknown API keys', function (done) {
      var apiKey = 'INVALID' + makeAPIKey().substr(7);

      (new zotero.Stream({ apiKey: apiKey }))
        .on('close', function (code, reason) {
          assert.equal(code, 4403);
          assert.equal(reason, 'Invalid API key');

          clearTimeout(this.retry.timeout);
          done();
        });
    });

    describe('given a valid key', function () {
      var apiKey, topics;

      beforeEach(function () {
        apiKey = makeAPIKey();
        topics = ['/users/123456', '/groups/234567'];

        sinon.stub(zoteroAPI, 'getAllKeyTopics', function (key) {
          if (key === apiKey) {
            return Promise.resolve(topics);
          }
        });
      });

      afterEach(function () { zoteroAPI.getAllKeyTopics.restore(); });

      it('should include all accessible topics', function (done) {
        (new zotero.Stream({ apiKey: apiKey }))
          .on('connected', function () {

            assert.ok(!this.subscriptions.empty);
            assert.sameMembers(this.subscriptions.topics, topics);

            this.close();
            done();
          });
      });

      describe('on topicAdded', function () {
        var newTopic;

        beforeEach(function () {
          topics = ['/users/123456'];
          newTopic = '/groups/234567';
        });

        it('should add a topic', function (done) {
          var allTopics;
          var topicUpdatedCalled = 0;

          (new zotero.Stream({ apiKey: apiKey }))

            .on('connected', function () {
              // Send topicAdded
              queue.postMessages({
                event: 'topicAdded', apiKey: apiKey, topic: newTopic
              });
            })

            .on('topicAdded', function (data) {
              // API key shouldn't be passed to single-key request
              assert.isUndefined(data.apiKey);
              assert.equal(this.subscriptions.all.length, 1);
              assert.isUndefined(this.subscriptions.all[0].apiKey);
              assert.equal(data.topic, newTopic);

              allTopics = this.subscriptions.topics;
              assert.equal(allTopics.length, 2);
              assert.sameMembers(allTopics, topics.concat(newTopic));

              // Send topicUpdated to old and new topics
              queue.postMessages(allTopics.map(function (topic) {
                return { event: 'topicUpdated', topic: topic };
              }));
            })

            .on('topicUpdated', function (data) {
              assert.equal(data.topic, allTopics[topicUpdatedCalled]);
              topicUpdatedCalled++;

              if (topicUpdatedCalled === allTopics.length) {
                this.close();
                done();
              }
            });

        });

      });
    });

  });


  //
  //
  // Multi-key requests
  //
  //
  describe('Multi-key event stream', function () {
  });
});
