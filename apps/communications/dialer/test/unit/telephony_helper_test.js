/* global ConfirmDialog, MocksHelper, MockIccHelper, MockMozL10n,
   MockMozMobileConnection, MockMozTelephony, MockNavigatorSettings,
   MockTonePlayer, Promise, TelephonyHelper */

'use strict';

requireApp('communications/dialer/test/unit/mock_lazy_loader.js');
requireApp('communications/dialer/test/unit/mock_contacts.js');
requireApp('communications/dialer/test/unit/mock_confirm_dialog.js');
requireApp('communications/dialer/test/unit/mock_l10n.js');
require('/shared/test/unit/mocks/mock_navigator_moz_settings.js');

requireApp('communications/dialer/test/unit/mock_moztelephony.js');
requireApp('communications/dialer/test/unit/mock_mozMobileConnection.js');
requireApp('communications/dialer/test/unit/mock_icc_helper.js');
requireApp('communications/dialer/test/unit/mock_tone_player.js');

requireApp('communications/dialer/js/telephony_helper.js');

var mocksHelperForTelephonyHelper = new MocksHelper([
  'Contacts',
  'ConfirmDialog',
  'LazyL10n',
  'LazyLoader',
  'IccHelper',
  'TonePlayer'
]).init();

suite('telephony helper', function() {
  var subject;
  var realMozSettings;
  var realMozTelephony;
  var realMozMobileConnection;
  var realMozMobileConnections;
  var realMozL10n;
  var spyConfirmShow;
  var mockTelephony;

  mocksHelperForTelephonyHelper.attachTestHelpers();

  suiteSetup(function() {
    subject = TelephonyHelper;

    realMozSettings = navigator.mozSettings;
    navigator.mozSettings = MockNavigatorSettings;

    realMozTelephony = navigator.mozTelephony;
    navigator.mozTelephony = MockMozTelephony;

    realMozMobileConnection = navigator.mozMobileConnection;
    navigator.mozMobileConnection = MockMozMobileConnection;

    realMozMobileConnections = navigator.mozMobileConnections;
    navigator.mozMobileConnections = [];

    realMozL10n = navigator.mozL10n;
    navigator.mozL10n = MockMozL10n;
  });

  suiteTeardown(function() {
    navigator.mozSettings = realMozSettings;
    navigator.mozTelephony = realMozTelephony;
    navigator.mozMobileConnection = realMozMobileConnection;
    navigator.mozMobileConnections = realMozMobileConnections;
    navigator.mozL10n = realMozL10n;
  });

  setup(function() {
    spyConfirmShow = this.sinon.spy(ConfirmDialog, 'show');
    mockTelephony = this.sinon.mock(MockMozTelephony);
  });

  teardown(function() {
    MockMozMobileConnection.mTeardown();
    MockMozTelephony.mTeardown();
    MockNavigatorSettings.mTeardown();
  });

  function createCallError(name) {
    return {call: {error: {name: (name || 'mock')}}};
  }

  test('should sanitize the given phone number before dialing', function() {
    var dialNumber = '(01) 45.34 55-20';
    mockTelephony.expects('dial').withArgs('0145345520');
    subject.call(dialNumber, 0);
    mockTelephony.verify();
  });

  test('should not dial the same number twice', function() {
    var dialNumber = '0145345520';
    MockMozTelephony.calls = [{number: dialNumber}];

    mockTelephony.expects('dial').never();
    subject.call(dialNumber, 0);

    mockTelephony.verify();
  });

  suite('Emergency dialing >', function() {
    var initialState;

    setup(function() {
      initialState = MockIccHelper.mCardState;
      MockIccHelper.mCardState = 'unknown';
      MockMozMobileConnection.voice.emergencyCallsOnly = true;
    });

    teardown(function() {
      MockIccHelper.mCardState = initialState;
    });

    suite('when there is no sim card', function() {
      setup(function() {
        MockMozMobileConnection.iccId = null;
      });

      test('it should always dial emergency with the first service',
      function() {
        var dialNumber = '112';
        mockTelephony.expects('dialEmergency').withArgs('112', 0);
        subject.call(dialNumber, 0);
        mockTelephony.verify();
      });
    });

    suite('when there is a sim card', function() {
      test('it should dial emergency with the default service', function() {
        var dialNumber = '112';
        mockTelephony.expects('dialEmergency').withArgs('112', undefined);
        subject.call(dialNumber, 0);
        mockTelephony.verify();
      });
    });
  });

  test('should dialEmergency if the connection is emergency only',
  function() {
    MockMozMobileConnection.voice.emergencyCallsOnly = true;
    var dialNumber = '112';
    mockTelephony.expects('dialEmergency').withArgs('112');
    subject.call(dialNumber, 0);
    mockTelephony.verify();
  });

  test('should hold the active line before dialing (if there is one)',
  function() {
    var dialNumber = '123456';
    var holdStub = this.sinon.stub();
    var mockActive = {
      number: '1111',
      state: 'connected',
      hold: holdStub
    };
    var dialSpy = mockTelephony.expects('dial').withArgs('123456');
    MockMozTelephony.active = mockActive;

    subject.call(dialNumber, 0);
    delete MockMozTelephony.active;
    mockActive.onheld();
    mockTelephony.verify();

    assert.isTrue(holdStub.calledBefore(dialSpy));
    assert.isNull(mockActive.onheld);
  });

  test('should hold the active group call before dialing (if there is one)',
  function() {
    var dialNumber = '123456';
    var holdStub = this.sinon.stub();
    MockMozTelephony.conferenceGroup.calls =
                        [{number: '111111'}, {number: '222222'}];
    MockMozTelephony.conferenceGroup.state = 'connected';
    MockMozTelephony.conferenceGroup.hold = holdStub;
    MockMozTelephony.active = MockMozTelephony.conferenceGroup;
    var dialSpy = mockTelephony.expects('dial').withArgs('123456');

    subject.call(dialNumber, 0);
    delete MockMozTelephony.active;
    MockMozTelephony.conferenceGroup.onheld();
    mockTelephony.verify();

    assert.isTrue(holdStub.calledBefore(dialSpy));
    assert.isNull(MockMozTelephony.conferenceGroup.onheld);
  });

  test('should not dial when call limit reached (2 normal call)', function() {
    MockMozTelephony.calls = [{number: '111111'}, {number: '222222'}];
    subject.call('333333', 0);
    assert.isTrue(spyConfirmShow.calledWith('unableToCallTitle',
                                            'unableToCallMessage'));
  });

  test('should not dial when call limit reached (1 normal call + 1 group call)',
  function() {
    MockMozTelephony.calls = [{number: '111111'}];
    MockMozTelephony.conferenceGroup.calls =
                            [{number: '222222'}, {number: '333333'}];
    subject.call('444444', 0);
    assert.isTrue(spyConfirmShow.calledWith('unableToCallTitle',
                                            'unableToCallMessage'));
  });

  test('should display an error if there is no network', function() {
    var dialNumber = '01 45 34 55 20';
    MockMozMobileConnection.voice = null;
    subject.call(dialNumber, 0);
    assert.isTrue(spyConfirmShow.calledWith('emergencyDialogTitle',
                                            'emergencyDialogBodyBadNumber'));
  });

  test('should display an error if the number is invalid', function() {
    var dialNumber = '01sfsafs45 34 55 20';
    subject.call(dialNumber, 0);
    assert.isTrue(spyConfirmShow.calledWith('invalidNumberToDialTitle',
                                            'invalidNumberToDialMessage'));
  });

  suite('Callbacks binding', function() {
    var mockCall;

    setup(function() {
      mockCall = {};
      this.sinon.stub(MockMozTelephony, 'dial').returns(mockCall);
    });

    test('should trigger oncall as soon as we get a call object',
    function(done) {
      subject.call('123', 0, function() {
        done();
      });
    });

    test('should bind the onconnected callback', function() {
      var onconnected = function uniq_onconnected() {};
      subject.call('123', 0, null, onconnected);
      assert.equal(mockCall.onconnected, onconnected);
    });

    test('should bind the ondisconnected callback', function() {
      var ondisconnected = function uniq_ondisconnected() {};
      subject.call('123', 0, null, null, ondisconnected);
      assert.isFunction(mockCall.ondisconnected);
      assert.equal(mockCall.ondisconnected, ondisconnected);
    });

    test('should trigger the onerror callback on error', function() {
      var onerrorStub = this.sinon.stub();
      subject.call('123', 0, null, null, null, onerrorStub);
      mockCall.onerror(createCallError());
      sinon.assert.called(onerrorStub);
    });
  });

  suite('Callbacks binding, promise edition', function() {
    var mockCall;
    var mockPromise;

    setup(function() {
      mockCall = {};
      mockPromise = Promise.resolve(mockCall);
      this.sinon.stub(MockMozTelephony, 'dial').returns(mockPromise);
    });

    test('should trigger oncall as soon as we get a call object',
    function(done) {
      subject.call('123', 0, function() {
        done();
      });
    });

    test('should bind the onconnected callback', function(done) {
      var onconnected = function uniq_onconnected() {};
      subject.call('123', 0, null, onconnected);
      mockPromise.then(function() {
        assert.equal(mockCall.onconnected, onconnected);
      }).then(done, done);
    });

    test('should bind the ondisconnected callback', function(done) {
      var ondisconnected = function uniq_ondisconnected() {};
      subject.call('123', 0, null, null, ondisconnected);
      mockPromise.then(function() {
        assert.isFunction(mockCall.ondisconnected);
        assert.equal(mockCall.ondisconnected, ondisconnected);
      }).then(done, done);
    });

    test('should trigger the onerror callback on error', function(done) {
      var onerrorStub = this.sinon.stub();
      subject.call('123', 0, null, null, null, onerrorStub);
      mockPromise.then(function() {
        mockCall.onerror(createCallError());
        sinon.assert.called(onerrorStub);
      }).then(done, done);
    });
  });

  suite('Call error handling', function() {
    var mockCall;
    setup(function() {
      mockCall = {};
      this.sinon.stub(MockMozTelephony, 'dial').returns(mockCall);
      this.sinon.stub(MockMozTelephony, 'dialEmergency').returns(mockCall);
    });

    suite('BadNumberError handle', function() {
      test('should display the BadNumber message', function() {
        subject.call('123', 0);
        mockCall.onerror(createCallError('BadNumberError'));
        assert.isTrue(spyConfirmShow.calledWith('invalidNumberToDialTitle',
                                                'invalidNumberToDialMessage'));
      });

      test('should display the NoNetwork message in emergency mode',
      function() {
        MockMozMobileConnection.voice.emergencyCallsOnly = true;
        subject.call('123', 0);
        mockCall.onerror(createCallError('BadNumberError'));
        assert.isTrue(spyConfirmShow.calledWith('emergencyDialogTitle',
                                               'emergencyDialogBodyBadNumber'));
      });
    });

    test('should handle BusyError', function() {
      subject.call('123', 0);
      mockCall.onerror(createCallError('BusyError'));
      assert.isTrue(spyConfirmShow.calledWith('numberIsBusyTitle',
                                              'numberIsBusyMessage'));
    });

    test('should handle FDNBlockedError', function() {
      subject.call('123', 0);
      mockCall.onerror(createCallError('FDNBlockedError'));
      assert.isTrue(spyConfirmShow.calledWith('fdnIsEnabledTitle',
                                              'fdnIsEnabledMessage'));
    });

    test('should handle FdnCheckFailure', function() {
      subject.call('123', 0);
      mockCall.onerror(createCallError('FdnCheckFailure'));
      assert.isTrue(spyConfirmShow.calledWith('fdnIsEnabledTitle',
                                              'fdnIsEnabledMessage'));
    });

    test('should play the busy tone', function() {
      var playSpy = this.sinon.spy(MockTonePlayer, 'playSequence');
      subject.call('123', 0);
      mockCall.onerror(createCallError('BusyError'));
      assert.isTrue(playSpy.calledOnce);
    });

    test('should handle DeviceNotAcceptedError', function() {
      subject.call('123', 0);
      mockCall.onerror(createCallError('DeviceNotAcceptedError'));
      assert.isTrue(spyConfirmShow.calledWith('emergencyDialogTitle',
                                       'emergencyDialogBodyDeviceNotAccepted'));
    });

    test('should handle RadioNotAvailable', function() {
      subject.call('123', 0);
      mockCall.onerror(createCallError('RadioNotAvailable'));
      assert.isTrue(spyConfirmShow.calledWith('callAirplaneModeTitle',
                                              'callAirplaneModeMessage'));
    });
  });

  suite('Call error handling, promise edition', function() {
    suite('onerror call errors', function() {
      var mockCall;
      var mockPromise;

      setup(function() {
        mockCall = {};
        mockPromise = Promise.resolve(mockCall);
        this.sinon.stub(MockMozTelephony, 'dial').returns(mockPromise);
        this.sinon.stub(MockMozTelephony, 'dialEmergency').returns(mockPromise);
      });

      // BadNumberError can come from the network
      suite('BadNumberError handle', function() {
        test('should display the BadNumber message', function(done) {
          subject.call('123', 0);
          mockPromise.then(function() {
            mockCall.onerror(createCallError('BadNumberError'));
            sinon.assert.calledWith(spyConfirmShow,'invalidNumberToDialTitle',
                                                  'invalidNumberToDialMessage');
          }).then(done, done);
        });

        test('should display the NoNetwork message in emergency mode',
        function(done) {
          MockMozMobileConnection.voice.emergencyCallsOnly = true;
          subject.call('123', 0);
          mockPromise.then(function() {
            mockCall.onerror(createCallError('BadNumberError'));
            sinon.assert.calledWith(spyConfirmShow,'emergencyDialogTitle',
                                                'emergencyDialogBodyBadNumber');
          }).then(done, done);
        });
      });

      test('should handle BusyError', function(done) {
        subject.call('123', 0);
        mockPromise.then(function() {
          mockCall.onerror(createCallError('BusyError'));
          assert.isTrue(spyConfirmShow.calledWith('numberIsBusyTitle',
                                                  'numberIsBusyMessage'));
        }).then(done, done);
      });

      test('should play the busy tone', function(done) {
        var playSpy = this.sinon.spy(MockTonePlayer, 'playSequence');
        subject.call('123', 0);
        mockPromise.then(function() {
          mockCall.onerror(createCallError('BusyError'));
          assert.isTrue(playSpy.calledOnce);
        }).then(done, done);
      });

      test('should handle FDNBlockedError', function(done) {
        subject.call('123', 0);
        mockPromise.then(function() {
          mockCall.onerror(createCallError('FDNBlockedError'));
          assert.isTrue(spyConfirmShow.calledWith('fdnIsEnabledTitle',
                                                  'fdnIsEnabledMessage'));
        }).then(done, done);
      });

      test('should handle FdnCheckFailure', function(done) {
        subject.call('123', 0);
        mockPromise.then(function() {
          mockCall.onerror(createCallError('FdnCheckFailure'));
          assert.isTrue(spyConfirmShow.calledWith('fdnIsEnabledTitle',
                                                  'fdnIsEnabledMessage'));
        }).then(done, done);
      });

      test('should handle DeviceNotAcceptedError', function(done) {
        subject.call('123', 0);
        mockPromise.then(function() {
          mockCall.onerror(createCallError('DeviceNotAcceptedError'));
          assert.isTrue(spyConfirmShow.calledWith('emergencyDialogTitle',
                                       'emergencyDialogBodyDeviceNotAccepted'));
        }).then(done, done);
      });

    });

    suite('promise errors', function() {
      var mockPromise;

      setup(function() {
        this.sinon.stub(MockMozTelephony, 'dial',
                        function() { return mockPromise;});
        this.sinon.stub(MockMozTelephony, 'dialEmergency',
                        function() { return mockPromise;});
      });

      // BadNumberError can come from a bad formatted number
      suite('BadNumberError handle', function() {
        test('should display the BadNumber message', function(done) {
          mockPromise = Promise.reject('BadNumberError');
          subject.call('123', 0);
          mockPromise.catch(function() {
            sinon.assert.calledWith(spyConfirmShow,'invalidNumberToDialTitle',
                                                  'invalidNumberToDialMessage');
          }).then(done, done);
        });

        test('should display the NoNetwork message in emergency mode',
        function(done) {
          mockPromise = Promise.reject('BadNumberError');
          MockMozMobileConnection.voice.emergencyCallsOnly = true;
          subject.call('123', 0);
          mockPromise.catch(function() {
            sinon.assert.calledWith(spyConfirmShow,'emergencyDialogTitle',
                                                'emergencyDialogBodyBadNumber');
          }).then(done, done);
        });
      });

      test('should handle RadioNotAvailable', function(done) {
        mockPromise = Promise.reject('RadioNotAvailable');
        subject.call('123', 0);
        mockPromise.catch(function() {
          sinon.assert.calledWith(spyConfirmShow, 'callAirplaneModeTitle',
                                                  'callAirplaneModeMessage');
        }).then(done, done);
      });

      test('should handle unknown errors', function(done) {
        mockPromise = Promise.reject('Gloubiboulga');
        var onerrorSpy = this.sinon.spy();
        subject.call('123', 0, null, null, null, onerrorSpy);
        mockPromise.catch(function() {
          sinon.assert.calledWith(spyConfirmShow, 'unableToCallTitle',
                                                  'unableToCallMessage');
          sinon.assert.calledOnce(onerrorSpy);
        }).then(done, done);
      });
    });
  });

  test('should display a message if we didn\'t get a call back', function() {
    this.sinon.stub(MockMozTelephony, 'dial').returns(null);
    subject.call('123', 0);
    assert.isTrue(spyConfirmShow.calledWith('unableToCallTitle',
                                            'unableToCallMessage'));
  });

  test('should display a message if we didn\'t get a call back,promise edition',
       function(done) {
    var mockPromise = Promise.reject();
    this.sinon.stub(MockMozTelephony, 'dial').returns(mockPromise);
    subject.call('123', 0);
    mockPromise.catch(function() {
      assert.isTrue(spyConfirmShow.calledWith('unableToCallTitle',
                                              'unableToCallMessage'));
    }).then(done, done);
  });

  test('should dial with correct card index', function() {
    var dialSpy = this.sinon.stub(MockMozTelephony, 'dial');
    subject.call('123', 1);
    sinon.assert.calledWith(dialSpy, '123', 1);
  });
});
