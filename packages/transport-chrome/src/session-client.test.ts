import type { JsonValue } from '@bufbuild/protobuf';
import { ConnectError } from '@connectrpc/connect';
import { errorToJson } from '@connectrpc/connect/protocol-connect';
import type { TransportMessage, TransportStream } from '@penumbra-zone/transport-dom/messages';
import { mockChannel, type MockedChannel } from '@repo/mock-chrome/runtime/channel.mock';
import type { MockedPort } from '@repo/mock-chrome/runtime/port.mock';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi, type Mock } from 'vitest';
import { ChannelLabel, nameConnection } from './channel-names.js';
import type { TransportInitChannel } from './message.js';
import { CRSessionClient } from './session-client.js';
import { expectChannelClosed } from './util/test/expect-channel-closed.js';
import { expectNoActivity } from './util/test/expect-no-activity.js';
import { lastResult } from './util/test/last-result.js';
import { replaceUncaughtExceptionListener } from './util/test/unhandled.js';

Object.assign(CRSessionClient, {
  clearSingleton() {
    // @ts-expect-error -- manipulating private property
    CRSessionClient.singleton = undefined;
    // @ts-expect-error -- manipulating private property
    CRSessionClient.managerId = undefined;
  },
});

describe('CRSessionClient', () => {
  let testName: string = undefined as never;

  let domPort: MessagePort | undefined;

  let mockedChannel: MockedChannel;

  let domMessageHandler: undefined | Mock<[MessageEvent<unknown>], void>;
  let domMessageErrorHandler: undefined | Mock<[MessageEvent<unknown>], void>;

  beforeEach(({ expect }) => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    // @ts-expect-error -- manipulating private property
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- manipulating private property
    void CRSessionClient.clearSingleton();

    testName = (expect.getState().currentTestName ?? 'no test name').split(' ').join('_');
    expect(testName).toBeDefined();

    domMessageHandler = undefined;
    domMessageErrorHandler = undefined;
    domPort = undefined;

    mockedChannel = mockChannel();

    vi.stubGlobal('chrome', { runtime: { connect: mockedChannel.connect } });
  });

  it('should return `MessagePort` on init, and connect the extension', () => {
    expect(mockedChannel.connect).not.toHaveBeenCalled();
    expect(mockedChannel.onConnect.dispatch).not.toHaveBeenCalled();

    domPort = CRSessionClient.init(testName);
    expect(domPort).toBeDefined();

    expect(mockedChannel.connect).toHaveBeenCalledOnce();
    expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledOnce();
  });

  describe('repeated calls to init', () => {
    it.fails('should return the same port for each call', () => {
      const ports: MessagePort[] = [];

      for (let i = 0; i < 3; i++) {
        ports.push(CRSessionClient.init(testName));
        ports.map(porty => expect(porty).toBeInstanceOf(MessagePort));
        expect(ports.every(porty => ports.every(porty2 => porty === porty2))).toBe(true);
        expect(mockedChannel.connect).toHaveBeenCalledTimes(1);
      }
    });

    it('should return a new port for each call', () => {
      const ports: MessagePort[] = [];

      for (let i = 0; i < 3; i++) {
        const newPort = CRSessionClient.init(testName);
        expect(ports.every(porty => porty !== newPort)).toBe(true);
        ports.push(newPort);
      }

      expect(mockedChannel.connect).toHaveBeenCalledTimes(ports.length);
    });
  });

  it('should attach callbacks to the port and forward messages', async () => {
    const exampleMessage: TransportMessage = { message: 'example message', requestId: '123' };

    domPort = CRSessionClient.init(testName);

    const extPort = lastResult(mockedChannel.mockPorts).onConnectPort;

    expect(extPort.onMessage.dispatch).not.toHaveBeenCalled();
    domPort.postMessage(exampleMessage);
    await vi.waitFor(() => expect(extPort.onMessage.dispatch).toHaveBeenCalled());

    expect(extPort.onMessage.dispatch).toHaveBeenLastCalledWith(
      exampleMessage,
      expect.objectContaining({
        name: expect.stringContaining(testName) as string,
      }),
    );
    expect(mockedChannel.mockSenders).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: expect.stringContaining(testName) as string,
      }),
    );
  });

  describe('should report errors', () => {
    const testMessage: TransportMessage = { requestId: '123', message: 'normal message' };

    let connectPortPostMessage: Mock<[unknown], void>;

    let domPort: MessagePort;

    beforeEach(() => {
      domMessageHandler = vi.fn();
      domMessageErrorHandler = vi.fn();

      domPort = CRSessionClient.init(testName);
      domPort.addEventListener('message', domMessageHandler);
      domPort.addEventListener('messageerror', domMessageErrorHandler);

      connectPortPostMessage = lastResult(mockedChannel.connect).postMessage;

      domPort.start();
    });

    describe('when forwarding the input throws an error', () => {
      let messageEventError: unknown;
      const postThrowError = Error('wololo', { cause: 'bad thing happened' });

      beforeEach(async () => {
        expect(domMessageHandler).not.toHaveBeenCalled();

        connectPortPostMessage.mockImplementationOnce(() => {
          throw postThrowError;
        });

        domPort.postMessage(testMessage);
        await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalled());
        expect(domMessageErrorHandler).not.toHaveBeenCalled();
        expect(domMessageHandler).toHaveBeenLastCalledWith(expect.any(MessageEvent));
        messageEventError = domMessageHandler?.mock.lastCall?.[0]?.data;
      });

      it.fails('responds with failure missing a `requestId`', () => {
        expect(messageEventError).not.toHaveProperty('requestId');
        expect(messageEventError).toMatchObject({
          error: {
            message: postThrowError.message,
            details: [
              {
                type: postThrowError.name,
                value: postThrowError.cause,
              },
              testMessage,
            ],
          },
        });
      });

      it('responds with failure including a `requestId`', () => {
        expect(messageEventError).toMatchObject({
          requestId: testMessage.requestId,
          error: errorToJson(ConnectError.from(postThrowError), undefined),
        });
      });
    });

    describe('when forwarding the input throws a non-error object', () => {
      let throwObjectResponse: unknown;
      const postThrowObject = { seriously: 'you should probably be throwing errors' };

      beforeEach(async () => {
        connectPortPostMessage.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing incorrect use
          throw postThrowObject;
        });

        domPort.postMessage(testMessage);
        await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalled());
        expect(domMessageHandler).toHaveBeenLastCalledWith(expect.any(MessageEvent));
        throwObjectResponse = domMessageHandler?.mock.lastCall?.[0].data;
      });

      it.fails('incorrectly responds with failure missing a `requestId`', () => {
        expect(throwObjectResponse).not.toHaveProperty('requestId');
        expect(throwObjectResponse).toMatchObject({
          error: {
            message: String(postThrowObject),
            details: [
              {
                type: (Object.getPrototypeOf(postThrowObject) as unknown)?.constructor?.name,
                value: postThrowObject,
              },
              testMessage,
            ],
          },
        });
      });

      it('correctly responds with failure including a `requestId`', () => {
        expect(throwObjectResponse).toMatchObject({
          requestId: testMessage.requestId,
          error: errorToJson(ConnectError.from(postThrowObject), undefined),
        });
      });
    });

    describe('when forwarding the input throws a non-cloneable item', () => {
      const postThrowFunction = () => 'why would you do this?';
      beforeEach(() => {
        connectPortPostMessage.mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- testing incorrect use
          throw postThrowFunction;
        });
      });

      it.fails('does not report failure and throws an uncaught `DataCloneError`', async () => {
        const { uncaughtExceptionListener, restoreUncaughtExceptionListener } =
          replaceUncaughtExceptionListener(vi.fn());
        onTestFinished(restoreUncaughtExceptionListener);

        expect(domMessageHandler).not.toHaveBeenCalled();
        domPort.postMessage(testMessage);

        await vi.waitFor(
          () =>
            expect(uncaughtExceptionListener).toHaveBeenLastCalledWith(
              expect.objectContaining({ name: 'DataCloneError' }),
              'uncaughtException',
            ),
          { timeout: 100 },
        );

        expect(domMessageHandler).not.toHaveBeenCalled();
      });

      it('reports failure', async () => {
        const { uncaughtExceptionListener, restoreUncaughtExceptionListener } =
          replaceUncaughtExceptionListener(vi.fn());
        onTestFinished(restoreUncaughtExceptionListener);

        expect(domMessageHandler).not.toHaveBeenCalled();
        domPort.postMessage(testMessage);
        await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalled(), { timeout: 100 });

        expect(domMessageHandler).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: {
              requestId: testMessage.requestId,
              error: errorToJson(ConnectError.from(postThrowFunction), undefined),
            },
          }),
        );

        expect(uncaughtExceptionListener).not.toHaveBeenCalled();
      });
    });
  });

  describe('when the input is invalid', () => {
    const badTransport: JsonValue[] = [
      { unknownFormat: true, requestId: '123' },
      { otherObject: 'whatever' },
      2,
      'hello',
      null,
    ];

    describe.each(badTransport)(
      'when the input is not a known `TransportEvent` %s',
      (badRequest: JsonValue) => {
        let domPort: MessagePort;
        let extPort: MockedPort;

        beforeEach(() => {
          domMessageHandler = vi.fn();
          domMessageErrorHandler = vi.fn();
          domPort = CRSessionClient.init(testName);
          domPort.addEventListener('message', domMessageHandler);
          domPort.addEventListener('messageerror', domMessageErrorHandler);
          domPort.start();

          extPort = lastResult(mockedChannel.mockPorts).onConnectPort;
        });

        afterEach(() => {
          expect(extPort.onMessage.dispatch).not.toHaveBeenCalled();
          expect(domMessageErrorHandler).not.toHaveBeenCalled();
        });

        it.fails('does not respond', async () => {
          domPort.postMessage(badRequest);

          // can't wait for the absence of an event, so just give it a moment
          await new Promise(resolve => void setTimeout(resolve, 50));

          expect(domMessageHandler).not.toHaveBeenCalled();
        });

        it.fails('responds with a failure', async () => {
          domPort.postMessage(badRequest);

          await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalled(), { timeout: 50 });

          const badRequestHasId =
            badRequest && typeof badRequest === 'object' && 'requestId' in badRequest;

          if (badRequestHasId) {
            expect(domMessageHandler).toHaveBeenCalledWith([
              expect.objectContaining({
                data: {
                  requestId: badRequest['requestId'],
                  error: expect.objectContaining({
                    message: expect.stringContaining('Unsupported request from client') as string,
                  }) as unknown,
                },
              }),
            ]);
          } else {
            expect(domMessageHandler).toHaveBeenCalledWith([
              expect.objectContaining({
                data: {
                  requestId: undefined,
                  error: expect.objectContaining({
                    message: expect.stringContaining('Unknown item from client') as string,
                  }) as unknown,
                },
              }),
            ]);
          }
        });

        it('responds with failure, and kills the session if not an event', async () => {
          domPort.postMessage(badRequest);

          const badRequestHasId =
            !!badRequest && typeof badRequest === 'object' && 'requestId' in badRequest;

          await vi.waitFor(
            () => expect(domMessageHandler).toHaveBeenCalledTimes(badRequestHasId ? 1 : 2),
            { timeout: 100 },
          );

          const responses = domMessageHandler?.mock.calls.map(([mev]) => mev.data) ?? [];

          if (!badRequestHasId) {
            // transport closed if a very invalid message was sent
            expect(responses.pop()).toBe(false);
          }

          // in all cases, an error returns
          expect(responses.pop()).toMatchObject(
            badRequestHasId
              ? {
                  // if the event had an id, it is unsupported
                  requestId: badRequest['requestId'],
                  error: {
                    code: 'unimplemented',
                    message: 'Unsupported request from client',
                  },
                }
              : {
                  // if the event did not have an id, it was not an event
                  error: {
                    code: 'unknown',
                    message: 'Unknown item from client',
                  },
                },
          );
        });
      },
    );
  });

  describe('disconnect behavior', () => {
    let sessionPort: MockedPort;
    let extPort: MockedPort;
    let domPort: MessagePort;

    beforeEach(() => {
      domPort = CRSessionClient.init(testName);

      domMessageHandler = vi.fn();
      domMessageErrorHandler = vi.fn();
      domPort.addEventListener('message', domMessageHandler);
      domPort.addEventListener('messageerror', domMessageErrorHandler);
      domPort.start();

      const lastPorts = lastResult(mockedChannel.mockPorts);
      sessionPort = lastPorts.connectPort;
      extPort = lastPorts.onConnectPort;
    });

    // a `chrome.runtime.Port` emits disconnect events, but a `MessagePort` does
    // not. so there is no good way to identify that a closed `MessagePort` is
    // closed. the holder of the port must track and understand when they have
    // closed the port.
    //
    // the session transmits `false` to represent the `MessagePort` will be
    // closed. the dom transport should handle this, and clients should not
    // persist in using transports that indicate they are disconnected.
    it('disconnects from the extension when the client transmits `false` message, and transmits a confirming `false` back to the dom', async () => {
      expectNoActivity(sessionPort, extPort, domMessageHandler);

      // announce disconnect
      domPort.postMessage(false);

      // client should discard the transport at this point.
      await vi.waitFor(() => expect(extPort.onDisconnect.dispatch).toHaveBeenCalledOnce());

      // disconnect is reported back to the dom. this would poison a typical transport.
      await vi.waitFor(() =>
        expect(domMessageHandler).toHaveBeenCalledWith(expect.objectContaining({ data: false })),
      );

      expect(sessionPort.disconnect).toHaveBeenCalledOnce();
      expect(sessionPort.postMessage).not.toHaveBeenCalled();
      expect(extPort.onMessage.dispatch).not.toHaveBeenCalled();

      await expectChannelClosed(sessionPort, extPort, domPort);
    });

    it('sends `false` to dom when an inactive port is disconnected by something else', async () => {
      expectNoActivity(sessionPort, extPort, domMessageHandler);

      // extension-side disconnect
      extPort.disconnect();

      // page will be notified of the extension-side disconnect
      await vi.waitFor(() => expect(sessionPort.onDisconnect.dispatch).toHaveBeenCalled());

      // disconnect is reported back to the dom. this would poison a typical transport.
      await vi.waitFor(
        () =>
          expect(domMessageHandler).toHaveBeenLastCalledWith(
            expect.objectContaining({ data: false }),
          ),
        { timeout: 100 },
      );

      expect(extPort.onMessage.dispatch).not.toHaveBeenCalled();
      expect(extPort.onDisconnect.dispatch).toHaveBeenCalledOnce();

      await expectChannelClosed(sessionPort, extPort, domPort);
    });

    it.fails('reconnects silently if the port is disconnected by something else', async () => {
      const testRequest: TransportMessage = { message: 'hello', requestId: '123' };

      expectNoActivity(sessionPort, extPort, domMessageHandler);

      const nextOnMessageListener = vi.fn<[unknown, chrome.runtime.Port]>();
      const nextOnConnectListener = vi.fn((port: chrome.runtime.Port) =>
        port.onMessage.addListener(nextOnMessageListener),
      );
      mockedChannel.onConnect.addListener(nextOnConnectListener);

      // extension-side disconnect
      extPort.disconnect();
      await vi.waitFor(() => expect(nextOnConnectListener).toHaveBeenCalled(), { timeout: 100 });

      // page will not be notified of the disconnect
      expect(domMessageHandler).not.toHaveBeenCalled();

      // the session should reconnect
      await vi.waitFor(
        () => {
          expect(sessionPort.onDisconnect.dispatch).toHaveBeenCalledOnce();
          expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledTimes(2);
        },
        { timeout: 100 },
      );

      expect(nextOnConnectListener).toHaveBeenCalledOnce();
      expect(nextOnMessageListener).not.toHaveBeenCalled();

      // try to send a message after disconnect
      domPort.postMessage(testRequest);

      await vi.waitFor(() =>
        expect(nextOnMessageListener).toHaveBeenCalledWith(
          testRequest,
          lastResult(mockedChannel.mockPorts).onConnectPort,
        ),
      );
    });

    it('reconnects for new requests if necessary', async () => {
      const testRequest: TransportMessage = { message: 'hello', requestId: '123' };

      expectNoActivity(sessionPort, extPort, domMessageHandler);

      const extOnMessageListener = vi.fn((m: unknown, p: chrome.runtime.Port) => p.postMessage(m));
      extPort.onMessage.addListener(extOnMessageListener);

      // try to send a message before disconnect
      domPort.postMessage(testRequest);

      // a reply should arrive
      await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalledOnce());
      expect(domMessageHandler?.mock.lastCall?.[0].data).toMatchObject(testRequest);

      const nextOnMessageListener = vi.fn<[unknown, chrome.runtime.Port]>();
      const nextOnConnectListener = vi.fn((port: chrome.runtime.Port) =>
        port.onMessage.addListener(nextOnMessageListener),
      );
      mockedChannel.onConnect.addListener(nextOnConnectListener);

      // extension-side disconnect
      extPort.disconnect();
      // the session should be disconnected,
      await vi.waitFor(() => expect(sessionPort.onDisconnect.dispatch).toHaveBeenCalledOnce(), {
        timeout: 100,
      });

      // page will not be notified of the disconnect
      expect(domMessageHandler).toHaveBeenCalledOnce();

      // kill some time for async
      await new Promise(resolve => void setTimeout(resolve, 50));

      // and should not have immediately reconnected
      expect(nextOnConnectListener).not.toHaveBeenCalled();
      expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledOnce();

      // try to send a message after disconnect
      domPort.postMessage(testRequest);

      // the session should reconnect and deliver the message
      await vi.waitFor(
        () => {
          expect(nextOnConnectListener).toHaveBeenCalled();
          expect(nextOnMessageListener).toHaveBeenCalledWith(
            testRequest,
            lastResult(mockedChannel.mockPorts).onConnectPort,
          );
        },
        { timeout: 100 },
      );

      // total number of `onConnect` expected
      expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledTimes(2);
    });

    it('kills the transport if the session experiences context loss', async () => {
      const transportError = {
        requestId: undefined,
        error: { code: 'unavailable', message: 'Extension context invalidated.' },
      };

      expectNoActivity(sessionPort, extPort, domMessageHandler);

      const testRequest: TransportMessage = { message: 'hello', requestId: '123' };

      expectNoActivity(sessionPort, extPort, domMessageHandler);

      const extOnMessageListener = vi.fn((m: unknown, p: chrome.runtime.Port) => p.postMessage(m));
      extPort.onMessage.addListener(extOnMessageListener);

      // try to send a message before disconnect
      domPort.postMessage(testRequest);

      // a reply should arrive
      await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalledOnce());
      expect(domMessageHandler?.mock.lastCall?.[0].data).toMatchObject(testRequest);

      mockedChannel.connect.mockImplementation(() => {
        throw new Error(transportError.error.message);
      });

      // extension-side disconnect
      extPort.disconnect();

      // the session should be disconnected
      await vi.waitFor(() => expect(sessionPort.onDisconnect.dispatch).toHaveBeenCalledOnce(), {
        timeout: 100,
      });

      // try to send a message after disconnect
      domPort.postMessage(testRequest);

      // the session will respond twice
      await vi.waitFor(() => expect(domMessageHandler).toHaveBeenCalledTimes(3), { timeout: 100 });

      // by reporting an error with `Code.Unavailable`, then closing the transport
      const requiredResponses = [false, transportError, testRequest];
      for (const [{ data: tev }] of domMessageHandler!.mock.calls) {
        expect(tev).toMatchObject(requiredResponses.pop()!);
      }
    });
  });

  describe('stream subchannels', () => {
    it('when receiving a stream channel response, should connect to stream subchannels', async () => {
      const unaryRequest: TransportMessage = { message: 'unary message', requestId: '123' };
      const streamResponse: TransportInitChannel = {
        channel: nameConnection(testName, ChannelLabel.STREAM),
        requestId: '123',
      };

      const extStreamConnectListener = vi.fn<[chrome.runtime.Port]>();
      const extOnMessageListener = vi.fn<[unknown, chrome.runtime.Port]>();
      const extSessionConnectListener = vi.fn((port: chrome.runtime.Port) => {
        if (port.name.startsWith(testName)) {
          port.onMessage.addListener(extOnMessageListener);
        }
      });

      mockedChannel.onConnect.addListener(extSessionConnectListener);

      domPort = CRSessionClient.init(testName);
      expect(domPort).toBeDefined();
      expect(mockedChannel.connect).toHaveBeenCalledTimes(1);
      expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledTimes(1);

      extOnMessageListener.mockImplementationOnce((_, port) => {
        mockedChannel.onConnect.addListener(extStreamConnectListener);
        port.postMessage(streamResponse);
      });
      domPort.postMessage(unaryRequest);
      await vi.waitFor(() => expect(mockedChannel.onConnect.dispatch).toHaveBeenCalledTimes(2));

      expect(mockedChannel.connect).toHaveBeenCalledTimes(2);
      expect(extOnMessageListener).toHaveBeenCalledOnce();
      expect(extStreamConnectListener).toHaveBeenCalledOnce();
      expect(extSessionConnectListener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: streamResponse.channel,
        }),
      );
      expect(mockedChannel.connect).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: streamResponse.channel }),
      );
    });

    it('when making a stream channel request, should listen for stream subchannels', async () => {
      const mockedChannel2 = mockChannel();

      // stub the chrome runtime in both directions, for this test
      vi.stubGlobal('chrome', {
        runtime: { connect: mockedChannel.connect, onConnect: mockedChannel2.onConnect },
      });

      const streamRequest: TransportStream = {
        stream: new ReadableStream({
          pull(controller) {
            controller.enqueue({ done: true });
            controller.close();
          },
        }),
        requestId: '123',
      };

      domPort = CRSessionClient.init(testName);
      expect(domPort).toBeDefined();
      expect(mockedChannel.connect).toHaveBeenCalledOnce();
      const extPort = lastResult(mockedChannel.mockPorts).onConnectPort;

      domPort.postMessage(streamRequest, [streamRequest.stream]);
      await vi.waitFor(() => expect(mockedChannel2.onConnect.addListener).toHaveBeenCalled());

      const channelInitMsg = extPort.onMessage.dispatch.mock.lastCall?.[0] as TransportInitChannel;

      expect(channelInitMsg).toMatchObject(
        expect.objectContaining({
          channel: expect.stringContaining(ChannelLabel.STREAM) as string,
        }),
      );

      const acceptStream = mockedChannel2.connect({ name: channelInitMsg.channel });

      expect(acceptStream.name).toBe(channelInitMsg.channel);
    });
  });
});
