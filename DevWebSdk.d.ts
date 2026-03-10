// Type definitions for [DevWeb SDK] [25.3.0]
// Project: [DevWeb]
// Definitions by: [DevWeb Team]

declare namespace load {
    import FileEntry = load.MultipartBody.FileEntry;
    import StringEntry = load.MultipartBody.StringEntry;

    export interface OnMessageOptions {
        /**
         * A unique number indicating the connection number.
         */
        id: string;
        /**
         * The received message.
         */
        data: string | Buffer;
        /**
         * The size (in bytes) of the received message.
         */
        size: number;
        /**
         * Indicates whether the received message is binary.
         */
        isBinaryData: boolean;
    }

    export interface OnOpenOptions {
        /**
         * A unique number indicating the connection number.
         */
        id: string;
        /**
         * The status code of the response.
         */
        status: number;
        /**
         *  A key value store of the headers in the response sent by the server.
         */
        headers: Object;
    }

    export interface OnCloseOptions {
        /**
         * A unique number indicating the connection number.
         */
        id: string;
        /**
         * The connection close status code.
         */
        code: number;
        /**
         * The connection close reason.
         */
        reason: string;
        /**
         * Indicates whether the connection was closed by client.
         */
        isClosedByClient: boolean;
    }

    export interface WebSocketConstructorOptions {
        /**
         * The WebSocket endpoint in ws:// or wss:// (secure WebSocket schema) format.
         */
        url: string,
        /**
         * A key value store that maps the header name to its value.
         */
        headers: Object,

        /**
         * A callback function for the "onMessage" event.
         */
        onMessage(msg: OnMessageOptions): void,

        /**
         * A callback function for the "onError" event.
         */
        onError?(msg: string): void,

        /**
         * A callback function for the "onOpen" event.
         */
        onOpen?(msg: OnOpenOptions): void,

        /**
         * A callback function for the "onClose" event.
         */
        onClose?(msg: OnCloseOptions): void
    }

    export interface WebSocketSendOptions {
        /**
         * The data to send. It can be either a string or a binary `Buffer`.
         */
        data: string | Buffer,
        /**
         * Path to a file to send its content.
         */
        dataPath: string,
        /**
         * If true, the data will be sent as a binary socket
         */
        isBinary: boolean

    }


    /**
     * An object that allows creating a WebSocket connection to the AUT. When creating a _WebSocket_ you
     need to pass an options object with mandatory and some optional configuration. Once set, you can
     send and receive messages over the socket.
     *
     * @export
     * @class WebSocket
     */
    export class WebSocket {
        readonly id: string;
        readonly url: string;

        /**
         * Creates a new WebSocket instance.
         * The mandatory _options_ argument must include at least the _url_ and the _onMessage_ properties, all the other properties are optional.
         */
        constructor(options: WebSocketConstructorOptions);

        /**
         * A callback function for the "onMessage" event.
         */
        onMessage(msg: OnMessageOptions): void;

        /**
         * A callback function for the "onError" event.
         */
        onError(error: string): void;

        /**
         * A callback function for the "onOpen" event.
         */
        onOpen(msg: OnOpenOptions): void;

        /**
         * A callback function for the "onClose" event.
         */
        onClose(msg: OnCloseOptions): void;

        /**
         * Opens the _WebSocket_ connection to the remote host. After calling this function it is possible to send and receive messages.
         *
         * @memberof WebSocket
         */
        open(): void;

        /**
         * Closes the connection to the server.
         * If the optional _code_ and _reason_ arguments are provided, then the connection is closed with given code and reason.
         *
         * @memberof WebSocket
         */
        close(code?: number, reason?: string): void;


        /**
         * Sends data to the connected server. based on the given _options_.
         */
        send(options: WebSocketSendOptions): void;


        /**
         * Sends the _data_ to the connected server.
         * In order to send a binary message, _data_ must be a `Buffer` object.
         *
         * @param {string | Buffer} data - The data to send. It can be either a string or a binary `Buffer`.
         * @memberof WebSocket
         */
        send(data: string | Buffer): void;

        /**
         * Returns a `Promise` that is resolved only when _continue_ is called on the _WebSocket_ or when the _timeout_ has expired.
         * The _timeout_ is given in milliseconds (**Default:** 120000 milliseconds) use -1 for unlimited.
         * This function can be used to asynchronously wait until some other event happens in the system.
         * If the timeout expires before _continue_ has been called, the returned promise is rejected.
         *
         * **Note:** Only one simultaneous call to _waitForData_ is allowed for each WebSocket.
         *
         * @param {number} timeout - The timeout in milliseconds. Default: 120000 milliseconds use -1 for unlimited.
         * @returns {Promise}
         * @memberof WebSocket
         */
        waitForData(timeout?: number): Promise<undefined>;

        /**
         * Resolves a promise previously created by _waitForData_.
         *
         * @memberof WebSocket
         */
        continue(): void;

        /**
         * Blocks the Vuser script until the connection to the server is closed.
         * The _timeout_ is given in milliseconds (**Default:** 120000 milliseconds) use -1 for unlimited.
         * Closure can occur due to the following:
         * 1. The server has closed the connection.
         * 2. _close_ was called on the WebSocket.
         * 3. The _timeout_ has passed and has expired.
         *
         * @param {number} timeout - The timeout in milliseconds. Default: 120000 milliseconds use -1 for unlimited.
         * @returns {Function}
         * @memberof WebSocket
         */
        waitForClose(timeout?: number): Promise<undefined>;

    }

    type errorHandlerCallback = (response: WebResponse) => void;

    export interface WebRequestOptions {
        /**
         * The url to which the request is sent.
         */
        url: string,
        /**
         * The HTTP method that will be used for the request.
         */
        method: string,
        /**
         * The id used to generate the corresponding snapshot file.
         */
        id?: number,
        /**
         * A key-value store that maps the header name to its value.
         */
        headers: Object,
        /**
         * A list of resources that will be downloaded as part of the request. An element in the array
         * can be a string, in this case, it will be used as the URL of the resources and the rest of the parameters (e.g. headers)
         * will be the same as in the WebRequest.
         */
        resources: Array<String | Object>,
        /**
         * Determines how HTTP errors will be handled.
         * The possible values are:
         * **Function with the signature `func(webResponse) : boolean`** - In this case, the function will be called with the
         * WebResponse object received from the request. The user may change the received response and it will be returned from the
         * call to _sendSync_. The function return value affects how the current iteration continues execution.
         * In case the function returns `false` the iteration will continue running as usual.
         * In any other case the iteration will end immediately.
         * **A string** - In this case a log message will be printed with the given string and the iteration will continue as usual.
         * **`null`**  (default) - The error is not handled, the current iteration will end.
         */
        handleHTTPError: string | errorHandlerCallback,
        /**
         * The _body_ of the request if the method supports a body (for example, POST, PUT).
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         *
         * Content-type examples:
         *
         * **www-form-urlencoded**. If body equals `{"foo": "bar", "bat": 10}` it is converted to `foo=bar&bat=10`.
         *
         * **text/plain** form. If body equals `{"foo": "bar", "bat": 10}` and `formDelimiter` is a newline character (\r\n), it is converted to: ```foo=bar
         * bat=10```
         *
         * **application/json**. If body equals `{"foo": "bar", "bat": 10}` it is converted to `'{"foo": "bar", "bat": 10}'`.
         * If the body is a `Buffer` object, it will be sent as binary data.
         */
        body: string | Object | Buffer,
        /**
         * The path to a file whose content will be used as the body of the request. This can be a path relative to the
         * script directory or an absolute path. This property is only used if the _body_ property is not set.
         */
        bodyPath: string,
        /**
         * The delimiter that will be used for form body fields separation.
         */
        formDelimiter: string,
        /**
         * When `true`, the _body_ property of the _WebResponse_ will be populated. Otherwise, the _body_ property of the _WebResponse_ will be set to `null`.
         */
        returnBody: boolean,
        /**
         * When `true`, the _body_ property will be a binary `Buffer` object.
         */
        isBinaryResponse: boolean,
        /**
         * When true, forces authentication header to be added to the request using the credentials provided by the ```load.setUserCredentials``` API. When false, wait for an HTTP 401 (unauthorized) before sending the credentials.
         */
        forceAuthentication: boolean,
        /**
         * When defined _WebRequest_ will be automatically signed with AWS Signature Version 4 using the credentials provided by the `load.setUserCredentials` API.
         * For example `{ region: "us-west-1", service: "sqs" }` will result in adding Authorization header with AWS Signature before request call.
         * For example `{ region: "us-west-1", service: "sqs", sign: "url" }` will result in adding AWS Signature as part of the request URL.
         */
        awsSigning: Object,
        /**
         * When `true`, _WebRequest_ redirects are not processed automatically.
         */
        disableRedirection: boolean,
        /**
         * A key-value store that maps the query string options. You may specify more than one value per key using the array notation.
         * For example `{ foo: "bar", baz: ["qux", "quux"], corge: "" }` will result in the following query string `"foo=bar&baz=qux&baz=quux&corge="`.
         */
        queryString: Object,
        /**
         * An extractor object or an array of extractor objects to apply on the response of this _WebRequest_.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>,
        /**
         * Associate a WebRequest with a transaction.
         * When the Dynatrace AppMon flag is enabled in the Runtime Settings, the default behavior is to associate each WebRequest with the transaction with the latest start time (if a transaction exists).
         * This transaction name is used to display the request in Dynatrace AppMon dashlets.
         * To change this behavior, manually define a value for TransactionName, or disable for a single request by entering an empty string: `""`.
         */
        transactionName?: string,
        /**
         * Destination character set of encoded form values. For example: `"iso-8859-1"`, `"windows-1252"`.
         *
         * {@link https://www.iana.org/assignments/character-sets/character-sets.xhtml|The supported character sets.}
         *
         * Default: `"utf-8"`.
         */
        charset?: string,
        /**
         * When `true`, the _resources_ property of the _WebRequest_ will include only resources that isn't included in the response html body. Otherwise, the _resources_ property of the _WebRequest_ will include all the resources from the response.
         */
        downloadHtmlStaticResources?: boolean,
        /**
         * When a path is defined (absolute path, or relative path to the script directory),
         * the response body of the WebRequest is saved to the file defined by the path.
         * */
        saveResponseBodyToFile?: string,
        /**
         * When `true`, the query string in the url is encoded. `false` will send url as-is.
         *
         * Default: `true`
         */
        enableURLEncoding?: boolean,
        /**
         * When `true`, the redirection url (in Location header) will be encoded.
         *
         * Default: `false`
         */
        enableRedirectionEncoding?: boolean,
    }


    /**
     * An object that allows you sending web requests to the AUT. When creating a _WebRequest_ you can pass an options objects with all the configuration you need for the request.
     * Then you can send the request in either asynchronous or synchronous way.
     *
     * @export
     * @class WebRequest
     */
    export class WebRequest {
        /**
         * Creates a new WebRequest instance. The user may provide the _options_ argument
         * which will override any default options. The options must include at least a "url"
         * property which is mandatory, while all the other properties are optional. Alternatively,
         * you can call the constructor with a string argument and then this argument will be the URL.
         */
        constructor(options: WebRequestOptions);

        /**
         * Sends the request to the defined URL (see constructor) and returns a promise which is
         * resolved with a _WebResponse_ object or rejected with an unhandled error.
         *
         * @returns {Promise < WebResponse >}
         * @memberof WebRequest
         */
        send(): Promise<WebResponse>;

        /**
         * The synchronous version of _send_. When called, the script execution is blocked until a response is returned. Returns the resulting _WebResponse_ object or
         * throws an exception if an error occurs and the error is not handled by the user via an error handler (see below).
         *
         * HTTP errors are handled by setting the _handleHTTPError_ property of the _WebRequest_.
         *
         * @returns {WebResponse}
         * @memberof WebRequest
         */
        sendSync(): WebResponse;
    }


    export interface ResourceItem {
        /**
         * The URL of the resource.
         */
        url: string,
        /**
         * The status code that was returned when the resource was downloaded.
         */
        status: number,
        /**
         * The size (in bytes) of the downloaded resource.
         */
        size: number
        /**
         * The resource round-trip time in milliseconds.
         */
        duration: number;
    }

    /**
     * This object is returned as a WebRequest result. You do not need to create it on your own.
     *
     * @export
     * @class WebResponse
     */
    export class WebResponse {
        /**
         * The status code of the response.
         */
        status: number;
        /**
         * A key value store of the headers in the response sent by the server.
         */
        headers: Object;
        /**
         * The size (in bytes) of the response.
         */
        size: number;
        /**
         * The UNIX timestamp in milliseconds of the engine time on which the request round-trip has started.
         */
        startTime: number;
        /**
         * The request round-trip time in milliseconds. Only main request round-trip time without resources and without redirections.
         */
        duration: number;
        /**
         * The body of the response. Note that the body is available only if the request had the property _returnBody_ set to `true`.
         * If _isBinaryResponse_ was set to `true`, the body will be a binary `Buffer` object.
         */
        body: string | Buffer;
        /**
         * The body of the response as an object (only applicable when the body is a valid json).
         *
         * **Note:** _jsonBody_ is available only if the request had the property _returnBody_ set to `true`.
         */
        jsonBody: Object;
        /**
         * The _WebRequest_ object that caused this response to be generated.
         */
        request: WebRequest;
        /**
         * A list of all the resources that were downloaded as part of the request.
         */
        resources: [Array<ResourceItem>];
        /**
         * A list of all the URLs that passed through while redirecting to this response
         */
        redirectUrls: Array<string>;
        /**
         * The results of the extractor applied on the response (refer to the full documentation for more information on the format of this object).
         */
        extractors: Object;

        /**
         * Checks if the given expression matches a substring within the body.
         *
         * **Note:** textCheck works only if the request had the property returnBody set to `true`.
         *
         * @param {string} expression can be either a string or a regular expression.
         * @returns `true` if the expression was found in the response body and `false` otherwise.
         */
        textCheck(expression: string): boolean
    }

    /**
     * You can send multipart web request by assigning the _MultipartBody_ object as the body of a _WebRequest_.
     */
    export class MultipartBody {
        /**
         * Creates a multipart body object with the given _entries_. The optional _boundary_ argument will be used to separate the entries within the sent body.
         * The _entries_ array should contain any of the available entry objects.
         *
         * @param entries
         * @param boundary
         */
        constructor(entries: Array<FileEntry | StringEntry>, boundary: string)
    }

    export namespace MultipartBody {
        /**
         * Represents a file entry within a multipart request.
         */
        class FileEntry {
            /**
             * Creates a file entry object based on the given _name_ and _filePath_.
             * You can specify the content type via the _contentType_ argument.
             * You can specify the file name of the sent file via the _fileName_ argument.
             *
             * @param {string} name - The name of the entry.
             * @param {string} filePath - The full path to the file.
             * @param {string} contentType - The content type of the entry. If content type was not specified `"text/plain"` will be used.
             * @param {string} fileName - The file name of the entry. If the file name is not specified it will be extracted from the _filePath_ argument.
             */
            constructor(name: string, filePath: string, contentType: string, fileName: string)
        }

        /**
         * Represents an entry of a single string.
         */
        class StringEntry {
            /**
             * Creates a string entry object based on the given _name_ and _value.
             *
             * @param {string} name - The name of the entry.
             * @param {string} value - The value of the entry.
             */
            constructor(name: string, value: string)
        }
    }

    export interface GrpcClientOptions {
        /**
         * The host of the gRPC server.
         */
        host: string,
        /**
         * When `true`, an unencrypted, plain connection is established with gRPC server.
         */
        isInsecure?: boolean,
        /**
         * The communication socket that is used for RPC connection. Possible values are `"tcp"` or `"unix"`. Default: `"tcp"`.
         */
        socket?: string,
        /**
         * When `false`, client verifies the server's certificate chain and host name during SSL connection. Default: `true`.
         */
        ignoreBadCertificate?: boolean,
        /**
         * The file path to client side certificate file. The file must contain PEM encoded data.
         */
        certificateLocation?: string,
        /**
         * The file path to client side certificate key file. The file must contain PEM encoded data.
         */
        certificateKeyLocation?: string,
        /**
         * The object containing all default options that will be used as options for any client methods.
         */
        defaults?: Object,
    }

    export interface UnaryRequestOptions {
        /**
         * A fully-qualified method name in 'package.Service/method' or 'package.Service.Method' format.
         */
        method: string,
        /**
         * The path to the protocol buffer .proto file.
         */
        protoFile: string,
        /**
         * The ID for the gRPC request.
         */
        id?: number,
        /**
         * A key value store that maps the header name to its value, gRPC metadata. Default `{}`.
         */
        headers?: Object,
        /**
         * The body of the method call. Default `""`.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example,
         * If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        body?: string | Object,
        /**
         * The path to a file whose content is used as the body of the request.
         * This can be a path relative to the script directory, or an absolute path. This property is used only if the _body_ property is not set.
         */
        bodyPath?: string,
        /**
         * When `true`, the _body_ property of the _GrpcResponse_ is populated. Otherwise, the _body_ property of the _GrpcResponse_ is set to `null`.
         */
        returnBody?: boolean,
        /**
         * An extractor object or an array of extractor objects to apply on the response of this _GrpcRequest_.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>,
    }

    export interface ClientStreamRequestOptions {
        /**
         * A fully-qualified method name in 'package.Service/method' or 'package.Service.Method' format.
         */
        method: string,
        /**
         * The path to the protocol buffer .proto file.
         */
        protoFile: string,
        /**
         * The ID for the gRPC request.
         */
        id?: number,
        /**
         * A key value store that maps the header name to its value, gRPC metadata. Default `{}`.
         */
        headers?: Object,
        /**
         * @deprecated use body instead.
         *
         * The body of the method call.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example, If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        bodyArray?: Array<string | Object>,
        /**
         * The body of the method call.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example, If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        body?: Array<string | Object>,
        /**
         * The path to a file whose content is used as the body of the request.
         * This can be a path relative to the script directory, or an absolute path. This property is used only if the _body_ property is not set.
         */
        bodyPath?: string,
        /**
         * When `true`, the _body_ property of the _GrpcResponse_ is populated. Otherwise, the _body_ property of the _GrpcResponse_ is set to `null`.
         */
        returnBody?: boolean,
        /**
         * An extractor object or an array of extractor objects to apply on the response of this _GrpcRequest_.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>,
    }

    export interface ServerStreamRequestOptions {
        /**
         * A fully-qualified method name in 'package.Service/method' or 'package.Service.Method' format.
         */
        method: string,
        /**
         * The path to the protocol buffer .proto file.
         */
        protoFile: string,
        /**
         * The ID for the gRPC request.
         */
        id?: number,
        /**
         * A key value store that maps the header name to its value, gRPC metadata. Default `{}`.
         */
        headers?: Object,
        /**
         * The body of the method call. Default `""`.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example,
         * If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        body?: string | Object,
        /**
         * The path to a file whose content is used as the body of the request.
         * This can be a path relative to the script directory, or an absolute path. This property is used only if the _body_ property is not set.
         */
        bodyPath?: string,
        /**
         * When `true`, the _body_ property of the _GrpcResponse_ is populated. Otherwise, the _body_ property of the _GrpcResponse_ is set to `null`.
         */
        returnBody?: boolean,
        /**
         * An extractor object or an array of extractor objects to apply on the response of this _GrpcRequest_.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>,
    }

    export interface BiDirectionalStreamRequestOptions {
        /**
         * A fully-qualified method name in 'package.Service/method' or 'package.Service.Method' format.
         */
        method: string,
        /**
         * The path to the protocol buffer .proto file.
         */
        protoFile: string,
        /**
         * The ID for the gRPC request.
         */
        id?: number,
        /**
         * A key value store that maps the header name to its value, gRPC metadata. Default `{}`.
         */
        headers?: Object,
        /**
         * @deprecated use body instead.
         *
         * The body of the method call.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example, If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        bodyArray?: Array<string | Object>,
        /**
         * The body of the method call.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example, If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        body?: Array<string | Object>,
        /**
         * The path to a file whose content is used as the body of the request.
         * This can be a path relative to the script directory, or an absolute path. This property is used only if the _body_ property is not set.
         */
        bodyPath?: string,
        /**
         * When `true`, the _body_ property of the _GrpcResponse_ is populated. Otherwise, the _body_ property of the _GrpcResponse_ is set to `null`.
         */
        returnBody?: boolean,
        /**
         * An extractor object or an array of extractor objects to apply on the response of this _GrpcRequest_.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>,
    }

    /**
     * An object that creates a new client that can be used to make RPCs to a gRPC server.
     *
     * @export
     * @class GrpcClient
     */
    export class GrpcClient {
        /**
         * Creates a new _GrpcClient_ instance. The user may provide the _options_ argument.
         * The options must include at least a _host_ property, all other properties are optional.
         * Alternatively, you can call the constructor with a string argument, and then this argument will be the host.
         */
        constructor(options: GrpcClientOptions);

        /**
         * Trying to connect the GRPC Client to server.
         * @param connectionTimeout - default of 30 seconds.
         */
        connect(connectionTimeout ?: number): Promise<any>;

        /**
         * Creates a new gRPC unary service method object instance.
         * The user can provide the _options_ argument, which will override any client default options.
         * The _options_ must include at least a _method_ and _protoFile_ properties, all other properties are optional.
         *
         * @returns {GrpcUnaryRequest}
         * @memberof GrpcClient
         */
        unaryRequest(options: UnaryRequestOptions): GrpcUnaryRequest;

        /**
         * Creates new client streaming RPC request instance.
         * The options must include the _method_ and _protoFile_ properties which are mandatory, while all the other properties are optional.
         *
         * @returns {GrpcClientStreamRequest}
         * @memberof GrpcClient
         */
        clientStreamRequest(options: ClientStreamRequestOptions): GrpcClientStreamRequest;

        /**
         * Creates new server streaming RPC request instance.
         * The options must include the _method_ and _protoFile_ properties which are mandatory, while all the other properties are optional.
         *
         * @returns {GrpcServerStreamRequest}
         * @memberof GrpcClient
         */
        serverStreamRequest(options: ServerStreamRequestOptions): GrpcServerStreamRequest;

        /**
         * Creates new bidirectional streaming RPC request instance.
         * The options must include the _method_ and _protoFile_ properties which are mandatory, while all the other properties are optional.
         *
         * @returns {GrpcBiDirectionalStreamRequest}
         * @memberof GrpcClient
         */
        biDirectionalStreamRequest(options: BiDirectionalStreamRequestOptions): GrpcBiDirectionalStreamRequest;
    }

    /**
     * Creates unary RPC request object.
     *
     * @class GrpcUnaryRequest
     */
    export class GrpcUnaryRequest {
        /**
         * Performs unary RPC to a gRPC server.
         * When called, the script execution is blocked until a response or error is returned. Returns the resulting _GrpcResponse_ object or throws an exception.
         *
         * @returns {GrpcResponse}
         * @memberof UnaryMethod
         */
        sendSync(): GrpcResponse;

        /**
         * Performs async unary RPC to a gRPC server and returns a promise which is resolved
         * with a GrpcResponse object or rejected with an unhandled error.
         *
         * @returns {Promise < GrpcResponse >}
         * @memberof UnaryMethod
         */
        send(): Promise<GrpcResponse>;
    }

    /**
     * Creates a client-streaming RPC request object.
     *
     * @class GrpcClientStreamRequest
     */
    export class GrpcClientStreamRequest {
        /**
         * Performs gRPC client streaming RPC to a gRPC server.
         * When called, the script execution is blocked until a response or error is returned. Returns the resulting _GrpcResponse_ object or throws an exception.
         *
         * @returns {GrpcResponse}
         * @memberof ClientStreamMethod
         */
        sendSync(): GrpcResponse;

        /**
         * Performs async client streaming RPC to a gRPC server and returns a promise which is resolved
         * with a GrpcResponse object or rejected with an unhandled error.
         *
         * @returns {Promise < GrpcResponse >}
         * @memberof ClientStreamMethod
         */
        send(): Promise<GrpcResponse>;
    }

    /**
     * Creates a server-streaming RPC request object.
     *
     * @class GrpcServerStreamRequest
     */
    export class GrpcServerStreamRequest {
        /**
         * Performs gRPC server streaming RPC to a gRPC server.
         * When called, the script execution is blocked until a response or error is returned. Returns the resulting _GrpcResponse_ object or throws an exception.
         *
         * @returns {GrpcResponse}
         * @memberof ServerStreamMethod
         */
        sendSync(): GrpcResponse;

        /**
         * Performs async gRPC server streaming to a gRPC server and returns a promise which is resolved
         * with a GrpcResponse object or rejected with an unhandled error.
         *
         * @returns {Promise < GrpcResponse >}
         * @memberof ServerStreamMethod
         */
        send(): Promise<GrpcResponse>;
    }

    /**
     * Creates a server-streaming RPC request object.
     *
     * @class GrpcBiDirectionalStreamRequest
     */
    export class GrpcBiDirectionalStreamRequest {
        /**
         * Performs gRPC bidirectional streaming RPC with a gRPC server.
         * When called, the script execution is blocked until a response or error is returned. Returns the resulting _GrpcResponse_ object or throws an exception.
         *
         * @returns {GrpcResponse}
         * @memberof BiDirectionalStreamMethod
         */
        sendSync(): GrpcResponse;

        /**
         * Performs async gRPC bidirectional streaming to a gRPC server and returns a promise which is resolved
         * with a GrpcResponse object or rejected with an unhandled error.
         *
         * @returns {Promise < GrpcResponse >}
         * @memberof BiDirectionalStreamMethod
         */
        send(): Promise<GrpcResponse>;
    }

    /**
     * This object is returned as a _GrpcRequest_ result. **You do not need to create it**.
     *
     * @export
     * @class GrpcResponse
     */
    export class GrpcResponse {
        /**
         * The status code of the response.
         */
        status: string;
        /**
         * A key value store of the gRPC metadata sent by the server.
         */
        headers: Object;
        /**
         * The size (in bytes) of the response.
         */
        size: number;
        /**
         * The UNIX timestamp in milliseconds for when the RPC began.
         */
        startTime: number;
        /**
         * The invoked round-trip time in milliseconds.
         */
        duration: number;
        /**
         * The body of the response.
         *
         * **Note:** The _body_ is available only if the request has the property _returnBody_ set to `true`.
         */
        body: string;
        /**
         * The body of the response as an object (only applicable when the body is a valid json).
         *
         * **Note:** `jsonBody` is available only if the request has the property `returnBody` set to `true`.
         */
        jsonBody: Object;
        /**
         * The results of the extractor applied on the response (refer to the full documentation for more information on the format of this object).
         */
        extractors: Object;
    }

    export interface OnSSEOpenOptions {
        /**
         * A unique number indicating the connection number.
         */
        id: string;
        /**
         * The status code of the response.
         */
        status: number;
        /**
         *  A key value store of the headers in the response sent by the server.
         */
        headers: Object;
    }

    export interface SSEConstructorOptions {
        /**
         * The SSE endpoint in http:// or https:// format.
         */
        url: string,
        /**
         * The HTTP method that will be used for the request.
         */
        method?: string,
        /**
         * The delimiter that separates between events. the default is "\n\n".
         */
        separator?: string,
        /**
         * A key value store that maps the header name to its value.
         */
        headers?: string,
        /**
         * The body of the method call. Default `""`.
         *
         * If a JSON object is provided, it is converted to a data string automatically upon send.
         * For example,
         * If body equals `{"foo":"bar", "bat":10}` it is converted to `'{"foo":"bar", "bat":10}'`.
         */
        body?: string | Object,
        /**
         * A callback function for the "onMessage" event.
         */
        onMessage(msg: string): void,

        /**
         * A callback function for the "onError" event.
         */
        onError?(error: string): void,

        /**
         * A callback function for the "onOpen" event.
         */
        onOpen?(msg: OnSSEOpenOptions): void,
    }

    export class SSE {
        /**
         * Creates a new SSE instance. The user should provide the _options_ argument
         * which will override any default options. The options must include at least a "url"
         * property which is mandatory, while all the other properties are optional.
         */
        constructor(options: SSEConstructorOptions);

        /**
         * Opens the SSE connection to the remote host. After calling this function it is possible to receive events from the server.
        */
        open(): void;

        /**
         * Closes the connection to the server.
         */
        close(): void;

        /**
         * A callback function for the "onMessage" event.
         */
        onMessage(msg: string): void;

        /**
         * A callback function for the "onError" event.
         */
        onError(error: string): void;

        /**
         * A callback function for the "onOpen" event.
         */
        onOpen(msg: OnSSEOpenOptions): void;
    }

    /**
     * Transactions are the means to measure the time it takes to execute certain, well defined, parts of the script.
     */
    export class Transaction {
        /**
         * Always set (none empty string). The name of the transaction as it was passed to the constructor
         */
        readonly name: string;
        /**
         * The last known state of the current transaction.
         */
        state: load.TransactionState;
        /**
         * Set on call to _start_. The UNIX timestamp in milliseconds of the engine time on which the transaction has started.
         */
        startTime: number;
        /**
         * Set on call to _stop_, _set_, or _update_ . The number of milliseconds passed since the call to _start_ until the transaction was ended either by a call to _end_ or by the engine.
         */
        duration: number;
        /**
         * Always set but you may need to call _update_ to get the updated value.
         */
        status: load.TransactionStatus;

        /**
         * Creates a new transaction with the given _name_.
         * **Note:** The created transaction has the "NotStarted" state and you must call the _start()_ method explicitly to start it.
         *
         * @param {string} name - The name of the transaction.
         */
        constructor(name: string);

        /**
         * Starts the transaction and changes its _status_ to "InProgress".
         */
        start(): void;

        /**
         * Stops the transaction and changes its status to the current status of the transaction.
         * If the optional _status_ argument is provided then the stopped transaction will have the given
         * status and not the current transaction status. The valid values for _status_ are "Passed" and "Failed"
         * and can be taken from `load.TransactionStatus.Passed` and `load.TransactionStatus.Failed`.
         * Calling _stop_ records the transaction duration in the _duration_ property.
         *
         * @param {load.TransactionStatus} status - If set then the stopped transaction will have the given status.
         */
        stop(status?: load.TransactionStatus): void;

        /**
         * Sets the transaction _status_ and _duration_ to the given arguments.
         * The given _status_ must be one of "Passed" or "Failed" (from `load.TransactionStatus`) and the given
         * _duration_ must be a non-negative number of milliseconds for the transaction duration.
         * **Note:** you cannot call _set_ on a started transaction.
         *
         * @param {load.TransactionStatus} status - The status to set, must be one of "Passed" or "Failed" (from `load.TransactionStatus`).
         * @param {number} duration - The duration of the transaction given in milliseconds.
         */
        set(status: load.TransactionStatus, duration: number): void;

        /**
         * Updates the _status_, _state_, and _duration_ properties of the transaction object.
         * The transaction must be either started or ended for the call to succeed.
         *
         * @returns the _Transaction_ object for piping.
         */
        update(): Transaction;
    }

    enum TransactionState {
        NotStarted,
        InProgress,
        Ended
    }

    enum TransactionStatus {
        Passed,
        Failed
    }

    enum LogLevel {
        error,
        warning,
        info,
        debug,
        trace
    }

    enum ExitType {
        iteration,
        stop,
        abort
    }

    enum ExtractorOccurrenceType {
        First,
        Last,
        All
    }

    enum ExtractorScope {
        Body,
        Headers,
        All
    }

    /**
     * A global configuration object that is used to supply various configuration data to the running Vuser.
     */
    export class config {
        /**
         * A set of properties of the currently running Vuser.
         */
        static user: {
            /**
             * The id of the currently running Vuser.
             */
            userId: number;
            /**
             * A map of key-value pairs supplied as command line arguments.
             */
            args: Object;
        };
        /**
         * A set of properties of the currently running script.
         */
        static script: {
            /**
             * The name of the script itself that this Vuser runs.
             */
            name: string;
            /**
             * The directory path to the script that this Vuser runs.
             */
            directory: string;
            /**
             * The full path to the script that this Vuser runs.
             */
            fullPath: string;
        };
        /**
         * A set of properties of the host machine that runs the script.
         */
        static host: {
            /**
             * The name of the machine running the current Vuser.
             */
            name: string;
            /**
             * The machine platform of the current Vuser.
             */
            platform: string;
        };
        /**
         * An object that contains all the environment variables as key value pairs.
         *
         * **Note:** The keys are case-sensitive, including on Windows.
         */

        static env: string;
        /**
         * Runtime properties of the Vuser script
         */
        static runtime: {
            /**
             * The number of the currently running iteration.
             */
            iteration: number;
        };
    }

    /**
     * Registers the given _callback_ as a named initialize of the script with the given _name_.
     * The initializes will be run in the same order as they are registered by calls to `load.initialize()` or by the order defined in the run logic.
     * The _callback_ may return a promise that will be used to determine if the _callback_ has succeeded or failed.
     *
     * @export
     * @param {string} name
     * @param {Function} callback
     */
    export function initialize(name: string, callback: Function): void;

    /**
     * Registers the given _callback_ to be run in the initialization phase of the test.
     * The _callback_ may return a promise that will be used to determine if the _callback_ has succeeded or failed.
     *
     * @export
     * @param {Function} callback
     */
    export function initialize(callback: Function): void;

    /**
     * Registers the given _callback_ as a named action of the script with the given _name_.
     * The actions will be run in the same order as they are registered by calls to `load.action()` or by the order defined in the run logic.
     * The _callback_ may return a promise that will be used to determine if the _callback_ has succeeded or failed.
     *
     * @export
     * @param {string} name
     * @param {Function} callback
     */
    export function action(name: string, callback: Function): void;

    /**
     * Registers the given _callback_ to be run in the action phase of the test.
     * The _callback_ may return a promise that will be used to determine if the _callback_ has succeeded or failed.
     * The actions will be run in the same order as they are registered by calls to `load.action()`.
     *
     * @export
     * @param {Function} callback
     */
    export function action(callback: Function): void;

    /**
     * Registers the given _callback_ as a named finalize of the script with the given _name_.
     * The finalizes will be run in the same order as they are registered by calls to `load.finalize()` or by the order defined in the run logic.
     * The _callback_ may return a promise that will be used to determine if the _callback_ has succeeded or failed.
     *
     * @export
     * @param {string} name
     * @param {Function} callback
     */
    export function finalize(name: string, callback: Function): void;

    /**
     * Registers the given _callback_ to be run in the finalization phase of the test.
     * The _callback_ may return a promise which will be used to determine if the _callback_ has succeeded or failed.
     *
     * @export
     * @param {Function} callback
     */
    export function finalize(callback: Function): void;

    /**
     * The log function writes a message to the Vuser log.
     * @param {string | Error | Object} message - The message to write.
     * @param {load.LogLevel} logLevel - The log level. Default: `load.LogLevel.info`.
     */
    export function log(message: string | Error | Object, logLevel?: load.LogLevel): void;

    /**
     * Pauses the running of the script for the given number of seconds (time can have a fractional part to simulate milliseconds).
     * @param {number} time - The number of seconds to pause.
     */
    export function sleep(time: number): void;

    /**
     * Pauses the running of the script for the given number of seconds (time can have a fractional part to simulate milliseconds).
     * This is non-blocking operation.
     * @param {number} time - The number of seconds to pause.
     * @returns {Promise < Object >}
     */
    export function sleepAsync(time: number): Promise<Object>;

    /**
     * Pauses the running of the script for the given number of seconds (time can have fractional part to simulate milliseconds).
     * @param {number} time - The number of seconds to pause.
     */
    export function thinkTime(time: number): void;

    /**
     * Pauses the running of the script for the given number of seconds (time can have a fractional part to simulate milliseconds).
     * This is non-blocking operation.
     * @param {number} time - The number of seconds to pause.
     * @returns {Promise < Object >}
     */
    export function thinkTimeAsync(time: number): Promise<Object>;

    /**
     * A function that allows you to stop the execution of the script.
     *
     * The _exitType_ argument is a string and can be one of:
     *
     * "iteration" (_ExitType.iteration_) - will stop the current iteration and continue to the next one after performing pacing.
     * "stop" (_ExitType.stop_) - will stop the current iteration and try to run the finalization section of the script, then exit.
     * "abort" (_ExitType.abort_) - will abort the execution of the script for the current Vuser (will not try to execute finalization).
     *
     * You may specify an optional _message_ argument which will be printed to the log.
     *
     * Note: Calling _exit_ from an asynchronous callback is not supported and will be ignored by the engine.
     *
     * @param exitType
     * @param message
     */
    export function exit(exitType: load.ExitType, message: string): void;

    export interface AuthenticationData {
        /**
         * The username for the authentication protocol.
         */
        username: string;
        /**
         * The password for the authentication protocol.
         */
        password: string;
        /**
         * A string specifying the host(s) to which this authentication record is applied.
         * It may contain a `"*"` to indicate any alphanumeric string. You may specify this field as `"*"` to match any host.
         * The _host_ field is the key of the authentication record. Therefore, creating a new authentication record with the same
         * host will overwrite the previous one. If two authentication records match the same host (via `"*"`) the first one registered will be used.
         */
        host: string;

        /**
         * The domain for which this authentication record is applicable.
         */
        domain: string;
    }

    /**
     * AWSAuthentication defines AWS user authentication credentials.
     */
    export class AWSAuthentication {
        /**
         * An AWS authentication provider type.
         */
        providerType: load.AWSProviderType;
        /**
         * Set on call to _start_. The UNIX timestamp in milliseconds of the engine time on which the transaction has started.
         */
        options?: Object;

        /**
         * Creates a new AWSAuthentication.
         *
         * @param {load.AWSProviderType} providerType - An AWS authentication provider type.
         * @param {object} options - An options based on provider type.
         */
        constructor(providerType: load.AWSProviderType, options?: Object);
    }

    enum AWSProviderType {
        Static,
        Env,
        Shared
    }

    /**
     * A function that allows you to specify authentication parameters for HTTP requests that require authentication.
     * The _authenticationData_ can be either an authentication record or an array of authentication records.
     * All subsequent requests will try to apply the given authentication data to any request that requires authentication.
     *
     * @param authenticationData
     */
    export function setUserCredentials(authenticationData: AuthenticationData | AWSAuthentication | Array<AuthenticationData>): void;

    /**
     * A function that allows you to specify certificate and key file path for HTTPS requests that require a certificate.
     * The files must contain PEM encoded data.
     * The _password_ argument is optional and will be used to read password protected PEM file.
     * All subsequent requests will try to use the given certificate to any request that require a certificate.
     *
     * @param certFilePath
     * @param keyFilePath
     * @param password
     */
    export function setUserCertificate(certFilePath: string, keyFilePath: string, password?: string): void;

    /**
     * A function that allows you to unmask masked value. The _maskedValue_ argument is a string generated using DevWebUtils executable.
     *
     * **Note:** Masking is not secure and anyone can unmask it.
     *
     * @param maskedValue
     */
    export function unmask(maskedValue: string): string;

    /**
     * A function that allows you to reveal a hide value. The **hiddenValue **argument is a string generated using DevWebUtils executable.
     *
     * @param hiddenValue
     */
    export function unhide(hiddenValue: string): string;

    /**
     * A function that allows you to decrypt encrypted value. The _encryptedValue_ argument is an encrypted string generated using DevWebUtils executable.
     *
     **Note:** During runtime encryption key file should be supplied.
     *
     * @param encryptedValue
     */
    export function decrypt(encryptedValue: string): string;

    /**
     * Parameters are values generated during runtime by the runtime engine and are exposed to the script
     * through the `load.params` variable. Each time you use a parameter variable, the next value will
     * be loaded automatically based on the next value selection strategy in the parameters definition file.
     */
    export var params: Object;


    /**
     * An interface representing an extractor object which can extract a value based on a specific implementation.
     */
    export interface ExtractorObject {
    }

    /**
     * This constructor will create a extractor object for the boundary extractor.
     * It will search the headers and the body of the response for any string that begins with _leftBoundary_ and terminates
     * with _rightBoundary_, and return the first matching string between the two boundaries. If nothing is found then
     * `null` is returned. For additional options please use the next constructor version.
     *
     * @export
     * @param {string} name - The name of the extractor
     * @param {string} leftBoundary - The left boundary of the extracted value
     * @param {string} rightBoundary - The right boundary of the extracted value
     * @returns {ExtractorObject}
     */
    export function BoundaryExtractor(name: string, leftBoundary: string, rightBoundary: string): ExtractorObject

    export interface BoundaryExtractorOptions {
        /**
         * The left boundary of the search.
         */
        leftBoundary: string;
        /**
         * The right boundary of the search.
         */
        rightBoundary: string;
        /**
         * The occurrence (previously Ordinal) of the result to return.
         * If _occurrence_ is not defined then the first occurrence is returned.
         * If _occurrence_ is set to a number, than the result with the given number index is returned.
         * If _occurrence_ is set to `load.ExtractorOccurrenceType.All` then all the found occurrences are returned as an array.
         * You may also set _occurrence_ to either `load.ExtractorOccurrenceType.First` or `load.ExtractorOccurrenceType.Last`
         * to retrieve the first or the last occurrence appropriately.
         */
        occurrence?: ExtractorOccurrenceType | number;
        /**
         * If set to `false` then the search will be using case-sensitive comparison.
         * If _caseInsensitive_ is not defined then the search will be using case-insensitive comparison.
         */
        caseInsensitive?: boolean;
        /**
         * The scope that will be searched.
         * If _scope_ is not defined then only the response body will be searched.
         * If _scope_ is set to `load.ExtractorScope.All` then both the response headers and the response body are searched for _text_.
         * You may set _scope_ to `load.ExtractorScope.Body` or `load.ExtractorScope.Headers` to search only the response body or the response headers, respectively.
         */
        scope?: ExtractorScope;
        /**
         * If set to `false` then the search will not be performed on the headers and body of all the pages returned by redirection of the `WebRequest`.
         */
        includeRedirections?: boolean;
        /**
         * The converters are applied to the extracted value and convert it from one format to another. The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.\
         * The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         *
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the boundary extractor.
     */
    export function BoundaryExtractor(name: string, options: BoundaryExtractorOptions): ExtractorObject

    /**
     * This constructor creates an extractor object for the regular expression extractor.
     * It searches the headers and the body of the response for a match of the given regular expression and returns the first match of the first group.
     * The documentation for the regular expression syntax can be found here: [https://github.com/google/re2/wiki/Syntax](https://github.com/google/re2/wiki/Syntax).
     * If nothing is found then `null` is returned.
     *
     * @export
     * @param {string} name - The name of the extractor.
     * @param {string} expression - The regular expression that will be used for the extraction.
     * @param {string} flags - The regular expression flags (see regular expression syntax documentation for more details).
     * @returns {ExtractorObject} If nothing is found then null is returned. For additional options please use the next constructor version.
     */
    export function RegexpExtractor(name: string, expression: string, flags: string): ExtractorObject

    export interface RegexpExtractorOptions {
        /**
         * The regular expression to search with.
         */
        expression: string;
        /**
         * The regular expression flags (see regular expression syntax documentation for more details).
         */
        flags: string;
        /**
         * The group number to return as a result (zero-based). If _groupNumber_ is not defined then the first group is returned.
         * You can set _groupNumber_ to 0, in this case both the full match and each search group in the regular expression are returned.
         * The full match is returned as the `full` property of the result and each group is represented in the `groups` array in the result.
         */
        groupNumber?: number;
        /**
         * The occurrence (previously Ordinal) of the result to return.
         * If _occurrence_ is not defined then the first occurrence is returned.
         * If _occurrence_ is set to a number, then the result with the given number index is returned.
         * If _occurrence_ is set to `load.ExtractorOccurrenceType.All` then all the found occurrences are returned as an array. In this case, each result is based on the _groupNumber_ parameter logic.
         * You may also set _occurrence_ to either `load.ExtractorOccurrenceType.First` or `load.ExtractorOccurrenceType.Last` to retrieve the first or the last occurrence appropriately.
         */
        occurrence?: ExtractorOccurrenceType | number;
        /**
         * The scope that will be searched.
         * If _scope_ is not defined then only the response body will be searched.
         * If _scope_ is set to `load.ExtractorScope.All` then both the response headers and the response body are searched for _text_.
         * You may set _scope_ to `load.ExtractorScope.Body` or `load.ExtractorScope.Headers` to search only the response body or the response headers, respectively.
         */
        scope?: ExtractorScope;
        /**
         * If set to `false` then the search will not be performed on the headers and body of all the pages returned by redirection of the _WebRequest_.
         */
        includeRedirections?: boolean;
        /**
         * The converters are applied to the extracted value and convert it from one format to another. The property value is a comma-separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         *  If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         *  The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         *  and _response_ - the _WebResponse_ before the transformation.
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string  // If defined, this function will be called before the _WebResponse_ is returned by `send` or `sendSync` on the extracted value.
    }

    /**
     * This constructor creates an extractor object for the regular expression extractor.
     * It searches the headers and the body of the response for a match of the given regular expression and returns the first match of the first group.
     * The documentation for the regular expression syntax can be found here: [https://github.com/google/re2/wiki/Syntax](https://github.com/google/re2/wiki/Syntax).
     * If nothing is found then `null` is returned.
     *
     * @param {string} name - The name of the extractor
     * @param {RegexpExtractorOptions} options The extractor options
     */
    export function RegexpExtractor(name: string, options: RegexpExtractorOptions): ExtractorObject

    export interface JsonPathExtractorOptions {
        /**
         * The JSON path to search with.
         */
        path: string;
        /**
         * If unspecified or is false, will return only the first result, otherwise will return an array with all the results.
         */
        returnMultipleValues?: boolean;
        /**
         * The converters are applied to the extracted value and convert it from one format to another. The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         * The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         *
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the JSON path extractor.
     * It will search the body of the response (if it is a valid JSON) and return the matching objects(s).
     * If nothing is found then `null` is returned.
     * If _returnMultipleValues_ is unspecified or is false, will return only the first result, otherwise will return an array with all the results.
     *
     * @param {string} name - The name of the extractor.
     * @param {string} path - The JSON path to search with.
     * @param {boolean} returnMultipleValues - `false` or unspecified will return the first item otherwise return list.
     */
    export function JsonPathExtractor(name: string, path: string, returnMultipleValues?: boolean): ExtractorObject;

    /**
     * This constructor will create an extractor object for the JSON path extractor.
     * It will search the body of the response (if it is a valid JSON) and return the matching objects(s).
     * If nothing is found then `null` is returned.
     * If _returnMultipleValues_ is unspecified or is false, will return only the first result, otherwise will return an array with all the results.
     *
     * @param {string} name - The name of the extractor.
     * @param {JsonPathExtractorOptions} options - The extractor options.
     */
    export function JsonPathExtractor(name: string, options: JsonPathExtractorOptions): ExtractorObject;

    export interface XpathExtractorOptions {
        /**
         * The Xpath to search with.
         */
        path: string;
        /**
         * If unspecified or is false, will return only the first result, otherwise will return an array with all the results.
         */
        returnMultipleValues?: boolean;
        /**
         * The converters are applied to the extracted value and convert it from one format to another.
         * The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         * The arguments are _value_ - the extracted value,
         * _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         *
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the Xpath extractor.
     * It will search the body of the response (if it is a valid XML) and return the matching objects(s).
     * If nothing is found then `null` is returned.
     * If _returnMultipleValues_ is unspecified or is `false`, the extractor will return only the first result, otherwise it will return an array with all the results.
     *
     * @param {string} name - The name of the extractor.
     * @param {string} path - The XPath to search with.
     * @param {boolean} returnMultipleValues - `false` or unspecified will return the first item otherwise return list.
     */
    export function XpathExtractor(name: string, path: string, returnMultipleValues?: boolean): ExtractorObject;

    /**
     * This constructor will create an extractor object for the Xpath extractor.
     * It will search the body of the response (if it is a valid XML) and return the matching objects(s).
     * If nothing is found then `null` is returned.
     *
     * @param {string} name - The name of the extractor.
     * @param {XpathExtractorOptions} options - The extractor options.
     */
    export function XpathExtractor(name: string, options: XpathExtractorOptions): ExtractorObject;

    export interface TextCheckExtractorOptions {
        /**
         * The string to search.
         */
        text: string;
        /**
         * The scope that will be searched.
         * If _scope_ is not defined then only the response body will be searched.
         * If _scope_ is set to `load.ExtractorScope.All` then both the response headers and the response body are searched for _text_.
         * You may set _scope_ to `load.ExtractorScope.Body` or `load.ExtractorScope.Headers` to search only the response body or the response headers, respectively.
         */
        scope?: string;
        /**
         * If defined, the actual result during runtime will be compared to this value and if equal an exception will be thrown stopping the script execution.
         */
        failOn?: any;
        /**
         * If set to `false` then the search will not be performed on the headers and body of all the pages returned by redirection of the _WebRequest_.
         */
        includeRedirections?: boolean;
        /**
         * The converters are applied to the extracted value and convert it from one format to another.
         * The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         * The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         *
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the text check extractor.
     * It will return `true` if the given _text_ was found in the response based on the _scope_ argument.
     * If the given _text_ is not found then `false` is returned.
     *
     * @param {string} name - The name of the extractor.
     * @param {string} text - The string to search.
     * @param {string} scope - The scope that will be searched.
     */
    export function TextCheckExtractor(name: string, text: string, scope?: string): ExtractorObject;
    /**
     * This constructor will create an extractor object for the text check extractor.
     * It will return `true` if the given _text_ was found in the response based on the _scope_ argument.
     * If the given _text_ is not found then `false` is returned.
     *
     * @param name - The name of the extractor.
     * @param options - The options object for the extractor.
     */
    export function TextCheckExtractor(name: string, options: TextCheckExtractorOptions): ExtractorObject;

    /**
     *  This constructor will create an extractor object for the HTML extractor.
     * It will search the body of the response (if it is a valid HTML) and return all the objects matching the given CSS query.
     * If nothing is found then `null` is returned.
     *
     * @param name - The name of the extractor.
     * @param query - The CSS query to use for finding the proper element.
     * @param attributeName - The name of the attribute whose value to extract.
     * @constructor
     */
    export function HtmlExtractor(name: string, query: string, attributeName: string): ExtractorObject;

    export interface HtmlExtractorOptions {
        /**
         * The CSS query selector to search with.
         */
        query: string;
        /**
         * The attribute whose value will be extracted. If not defined inner text is extracted.
         */
        attributeName: string;
        /**
         * The occurrence of the result to return.
         * If _occurrence_ is not defined then the first occurrence is returned.
         * If _occurrence_ is set to a number, than the result with the given number index is returned.
         * If _occurrence_ is set to `load.ExtractorOccurrenceType.All` then all the found occurrences are returned as an array.
         * You may also set _occurrence_ to either `load.ExtractorOccurrenceType.First` or `load.ExtractorOccurrenceType.Last`
         * to retrieve the first or the last occurrence appropriately.
         */
        occurrence?: ExtractorOccurrenceType | number;
        /**
         * The converters are applied to the extracted value and convert it from one format to another.
         * The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         * The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the HTML extractor.
     * It will search the body of the response (if it is a valid HTML) and return all the objects matching the given CSS query.
     * If nothing is found then `null` is returned.
     *
     * @param name - The name of the extractor
     * @param options - The options of the extractor
     * @constructor
     */
    export function HtmlExtractor(name: string, options: HtmlExtractorOptions): ExtractorObject;

    /**
     * This constructor will create an extractor object for the cookie extractor.
     * It will search cookies of the response by cookie name, domain and path. If nothing is found then
     * `null` is returned. For additional options please use the next constructor version.
     *
     * @export
     * @param {string} name - The name of the extractor
     * @param {string} cookieName - The name of the cookie
     * @param {string} domain - The domain of the cookie
     * @param {string} path - The domain of the path
     * @returns {ExtractorObject}
     */
    export function CookieExtractor(name: string, cookieName: string, domain: string, path: string): ExtractorObject

    export interface CookieExtractorOptions {
        /**
         * The cookie name.
         */
        cookieName: string;
        /**
         * The cookie domain.
         */
        domain?: string;
        /**
         * The cookie path.
         */
        path?: string;
        /**
         * The occurrence (previously Ordinal) of the result to return.
         * If _occurrence_ is not defined then the first occurrence is returned.
         * If _occurrence_ is set to a number, than the result with the given number index is returned.
         * If _occurrence_ is set to `load.ExtractorOccurrenceType.All` then all the found occurrences are returned as an array.
         * You may also set _occurrence_ to either `load.ExtractorOccurrenceType.First` or `load.ExtractorOccurrenceType.Last`
         * to retrieve the first or the last occurrence appropriately.
         */
        occurrence?: ExtractorOccurrenceType | number;
        /**
         * If set to `false` then the search will be using case-sensitive comparison.
         * If _caseInsensitive_ is not defined then the search will be using case-insensitive comparison.
         */

        /**
         * If set to `false` then the search will not be performed on the headers and body of all the pages returned by redirection of the _WebRequest_.
         */
        includeRedirections?: boolean;

        /**
         * The converters are applied to the extracted value and convert it from one format to another.
         * The property value is a comma separated list of converters to run sequentially on the extracted value.
         * Supported converters are: `urlEncode`, `urlDecode`, `htmlEscape`, `htmlUnescape`, `base64Encode`, `base64Decode`, `evalString`
         */
        converters?: string;

        /**
         * If defined, this function will be called before the _WebResponse_ is returned by _send_ or _sendSync_ on the extracted value.
         * The arguments are _value_ - the extracted value, _request_ - the _WebRequest_ from which the value was extracted,
         * and _response_ - the _WebResponse_ before the transformation.
         *
         * **Note:** The order in which the transformations are called is the same order in which the extractors appear within _WebRequest_ _extractors_ property.
         */
        transform?(value: string, request: WebRequest, response: WebResponse): string
    }

    /**
     * This constructor will create an extractor object for the cookie extractor.
     *
     */
    export function CookieExtractor(name: string, options: CookieExtractorOptions): ExtractorObject


    export interface CookieOptions {
        /**
         * The name of the cookie.
         */
        name: string;
        /**
         * The value of the cookie.
         */
        value: string;
        /**
         * The maximum lifetime of the cookie as an HTTP-date timestamp.
         */
        expires?: string;
        /**
         * Number of seconds until the cookie expires.
         */
        maxAge?: number;
        /**
         * The hosts to which the cookie will be sent.
         */
        domain: string;
        /**
         * A URL path that must exist in the requested resource before sending the Cookie header.
         */
        path?: string;
        /**
         * Indicates whether the cookies is secure or not.
         */
        isSecure?: boolean;
        /**
         * HTTP-only cookies aren't accessible via JavaScript.
         */
        isHttpOnly?: boolean;
        /**
         * Allows servers to assert that a cookie ought not to be sent along with cross-site requests.
         */
        sameSite?: "strict" | "lax"
    }


    export class Cookie {
        /**
         * Creates a cookie object that can be used in a _setCookie_ call. The mandatory _options_ argument can be either
         * an object with the cookie fields or a string.
         * See definitions in the ["Set-Cookie"](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie) command definition.
         *
         * @param options
         */
        constructor(options: CookieOptions);

        /**
         * Takes a `load.Cookie` object or an array of `load.Cookie` objects and deletes them from the engine.
         * No error is returned if one or more of the given cookies don't exist in the engine (i.e. were not previously added by _addCookies()_).
         *
         * @param {Cookie | Array<Cookie>} cookie
         * @memberof Cookie
         */
        deleteCookies(cookie: Cookie | Array<Cookie>): void;

        /**
         * Takes a `load.Cookie` object or an array of `load.Cookie` objects and adds them to the engine.
         * The cookies will be used when needed according to the url of the web request.
         *
         * @param {Cookie | Array <Cookie>} cookie
         * @memberof Cookie
         */
        addCookies(cookie: Cookie | Array<Cookie>): void;

        /**
         * Deletes all the cookies that were added to the engine via _addCookies() _.
         *
         * @memberof Cookie
         */
        clearCookies(): void;
    }

    export interface Base64Options {
        /**
         * Value character set.
         */
        charset?: string;
        /**
         * If true, modified Base64 for URL encoding will be used.
         * In Base64 for URL encoding the '+' and '/' characters of standard Base64 are respectively replaced by '-' and '_', so that using URL encoders/decoders is no longer necessary.
         * Base64 for URL encoding is usually used for as part of URL address or filename.
         */
        base64URL?: boolean;
        /**
         * If true, padding characters '=' will be omitted. Some variants allow or require omitting the padding '=' signs to avoid them being confused with field separators.
         */
        noPadding?: boolean;
        /**
         * When `true`, operation response is expected to be binary and therefore will be returned in a `Buffer`.
         */
        isBinaryContent?: boolean;
    }

    export interface RandomStringOptions {
        /**
         * If `true`, lowercase and uppercase letters will be used as part of generated string.
         */
        letters?: boolean;
        /**
         * If `true`, digits will be used as part of generated string.
         */
        digits?: boolean;
        /**
         If `true`, specialChars `[-_@#!$%&(){}]` will be used as part of generated string.
         */
        specialChars?: boolean;
        /**
         If `true`, hexadecimal will be used as part of generated string.
         */
        hex?: boolean;
        /**
         * If specified generated string will be based on custom character set.
         */
        custom?: string;
    }

    export interface HashOptions {
        /**
         * The algorithm to use for the hash
         */
        algorithm: load.HashAlgorithm;

        /**
         * The encoding of the output
         */
        outputEncoding?: load.HashOutputEncoding;
    }

    export interface HmacOptions {
        /**
         * The algorithm to use for the hash
         */
        algorithm: load.HashAlgorithm;

        /**
         * The secret key to use with the hash function
         */
        secret: string;
        /**
         * The encoding of the output
         */
        outputEncoding?: load.HashOutputEncoding;
    }

    export interface TotpOptions {
        /**
         * Number of seconds a TOTP hash is valid for. Defaults to 30 seconds.
         */
        period: number;

        /**
         * Time in seconds the totp device time is allowed to drift in respect to the server time.
         */
        skew: number;

        /**
         * The number of digits the OTP consist of (minimum is 4).
         */
        digits: number;

        /**
         * The algorithm that is used to generate the OTP. It is used on authentication and registration.
         * Algorithms supported are: SHA1, SHA256, SHA512, MD5.
         */
        algorithm: load.HashAlgorithm;
    }

    enum HashAlgorithm {
        md5,
        sha1,
        sha256,
        sha384,
        sha512
    }

    enum HashOutputEncoding {
        /**
         * base64 is the default.
         * Standard base64 encoded string representation.
         */
        base64,
        /** Standard base64 encoding without `=` padding character. */
        base64Raw,
        /** Base64 for URL encoding string representation. */
        base64URL,
        /** Base64 for URL encoding encoding without `=` padding character. */
        base64RawURL,
        /** Hexadecimal string representation. */
        hex
    }

    export namespace utils {
        /**
         * Returns the substring within the source string between leftBoundary and rightBoundary.
         * If leftBoundary is undefined then the beginning of the source string is used as the left boundary.
         * If rightBoundary is undefined then the end of the source string is used as the right boundary.
         * If either boundary is not found in the source string or the source string is invalid then null is returned.
         *
         * @param {string} source - The string to search within.
         * @param {string} leftBoundary - The left boundary of the search.
         * @param {string} rightBoundary - The right boundary of the search.
         * @returns {string}
         * @memberof utils
         */
        export function getByBoundary(source: string, leftBoundary: string, rightBoundary: string): string

        /**
         * Reports a data point with the given name and value to the results database.
         * The reported value will be in the CustomDataPoints table in the results database.
         * The timestamp and the reporting Vuser Id will be automatically added.
         *
         * **Note:** The _value_ must be a number.
         *
         * @param {string} name - The name of the datapoint.
         * @param {number} value - The value of the datapoint (numeric).
         * @memberof utils
         */
        export function reportDataPoint(name: string, value: number): void

        /**
         * Returns the base64 encoding of value.
         *
         * @param {string} value - The string to base64 encode.
         * @param options - The options of the base64 encode.
         * @returns {string}
         * @memberof utils
         */
        export function base64Encode(value: string, options?: Base64Options): string

        /**
         * Returns the `string` or `Buffer` represented by the base64 value.
         *
         * @param {string} value - The string to base64 decode.
         * @param options - The options of the base64 decode.
         * @returns {string | Buffer}
         * @memberof utils
         */
        export function base64Decode(value: string, options?: Base64Options): string | Buffer

        /**
         * Returns a generated random string of _size_ size.
         *
         * @param {number} size - The size of string to generate.
         * @param options - The options of the random string generation.
         * @returns {string}
         * @memberof utils
         */
        export function randomString(size: number, options?: RandomStringOptions): string

        /**
         * Returns a generated uuid v4.
         *
         * @returns {string}
         * @memberof utils
         */
        export function uuid(): string

        /**
         * Returns cryptographic hash computation of _input_ string according to selected _algorithm_.
         *
         * @param {string} algorithm - The hash algorithm
         * @param {string} input - The input string to hash
         * @param {string} outputEncoding - The encoding of the output
         * @returns {string} - The given input hashed with the given algorithm and encoded with the given encoding
         * @memberof utils
         */
        export function hash(algorithm: load.HashAlgorithm, input: string, outputEncoding?: load.HashOutputEncoding): string

        /**
         * Returns cryptographic hash computation of _input_ string according to selected _algorithm_.
         *
         * @param {string} input - The input string to hash
         * @param {object} options - Options used to compute the hash value
         * @returns {string} - The hashed input
         * @memberof utils
         */
        export function hash(input: string, options: load.HashOptions): string

        /**
         * Returns cryptographic keyed hash (HMAC) computation of _input_ string according to selected _algorithm_.
         *
         * @param {string} algorithm - The hash algorithm
         * @param {string} secret - The key to use with the hash algorithm
         * @param {string} input - The input string to hash
         * @param {string} outputEncoding - The encoding of the output
         * @returns {string} - he given input hashed with the given algorithm and encoded with the given encoding protected by the given secret
         * @memberof utils
         */
        export function hmac(algorithm: load.HashAlgorithm, secret: string, input: string, outputEncoding?: load.HashOutputEncoding): string

        /**
         * Returns cryptographic keyed hash (HMAC) computation of _input_ string according to selected _algorithm_.
         *
         * @param {string} input - The input string to hash
         * @param {object} options - Options used to compute the hash value
         * @returns {string} - The hashed input
         * @memberof utils
         */
        export function hmac(input: string, options: load.HmacOptions): string

        /**
         * Returns a SAML encoded string of _value_. The SAML message must be deflated, and base64 encoded, before sending as part of the _WebRequest_.
         *
         * @param {string} value - The string to encode.
         * @returns {string} - The deflated and base64 encoded value.
         * @memberof utils
         */
        export function samlEncode(value: string): string

        /**
         * Returns a Time-based One Time Password based on the _secret_, _timestamp_ and _options_ if provided.
         *
         * @param {string} secret - The user's secret.
         * @param {number} timestamp - Unix timestamp.
         * @param {object} options - The TOTP options: Period, Skew, Digits, Algorithm (default: {Period: 30, Skew: 1, Digits: 6, Algorithm: sha1}.
         * @returns {string} - The TOTP token
         * @memberof utils
         */
        export function totp(secret: string, timestamp: number, options?: load.TotpOptions): string

        /**
         * This class provides a mechanism to chain calls to other _utils_ functions or custom functions that have one of the signatures:
         * `func()`, `func(value)`, `func(value,options)`.
         */
        export class Chain {
            /**
             * It is possible to pass as many (function, options) pairs as needed. A _fn_ argument can be a name of a function
             * on the _utils_ object or any other function that takes a value as its first argument and returns a value.
             * If there is no option to pass to a specific function, omit the argument altogether.
             *
             * @param fn - The function to run in the chain
             * @param options - Optional argument to the function
             * @param functionsOptionsPairs - More functions and options as needed
             */
            constructor(fn: (value: string, options: Object) => string, options?: Object, ...functionsOptionsPairs)

            /**
             * Runs the chain on the given _value_.
             *
             * @param value - The initial value to run the chain on
             */
            run(value: any): any
        }

    }

    export namespace net {
        /**
         * Returns a SRV record target with respect to its priority and weight.
         * If several SRV records have the same priority, then the target will be selected randomly with
         * respect to the weight distribution. See also https://datatracker.ietf.org/doc/html/rfc2782.
         *
         * @param {string} service - The service name
         * @param {string} protocol - The service protocol.
         * @param {string} domain - The domain name.
         */
        export function lookupService(service, protocol, domain): string


        /**
         * Returns an array of local IPs configured on the local machine.
         *
         * @param {string} ipVersion - The version of the ips to return. 'IPv4'/'4'/4, 'IPv6'/'6'/6, 'All'/'all'. Default: `IPv4`.
         */
        export function getIPList(ipVersion): string[]

        /**
         * Set an IP for the current Vuser. It should be a valid IP on the local machine.
         *
         * @param {string} ip - The ip to set
         */
        export function setIP(ip): void

        /**
         * Get the IP for the current Vuser. Can be used only when multiIP is active, or if IP was set by setIP function.
         */
        export function getIP(): string
    }

    export namespace azure {
        export interface KeyVaultTokenOptions {
            /**
             * the azure key-vault uri.
             */
            vaultName: string,
            /**
             * the azure tenant id.
             */
            tenantId: string,
            /**
             * The azure client id.
             */
            clientId: string,
            /**
             * @param The azure client secret.
             */
            clientSecret: string
        }

        export interface KeyVaultSecretOptions {
            /**
             * the azure secret name.
             */
            secret: string,
            /**
             * the azure token id.
             */
            token: string,
        }
        /**
         * Returns key-vault token (string) which represents a key vault client, in order to use
         * other azure functions.
         *
         * @param {string} vaultName - the azure key-vault uri.
         * @param {string} tenantId - the azure tenant id.
         * @param {string} clientId - The azure client id.
         * @param {string} clientSecret - The azure client secret.
         */
         export function getToken(vaultName: string, tenantId: string, clientId: string, clientSecret: string): string

        /**
         * Same as above receiving object.
         */
        export function getToken(options: KeyVaultTokenOptions): string

         /**
         * Returns kay vault secret value which represents a key vault client, in order to use 
         * other azure functions.
         *
         * @param {string} secret - the azure secret name.
         * @param {string} token - the azure token id.
         */
        export function getSecret(secret: string, token: string): string

        /**
         * Same as above receiving object.
         */
        export function getSecret(options: KeyVaultSecretOptions): string
    }

    /**
     * While we don't allow changing the properties of the _load_ object, we have provided a global object for you
     * to store your data. You can access this object via the `load.global` property.
     */
    export var global: Object;

    /**
     * An object that collects all the values extracted by all the extractors running in the script.
     * If two extractors have the same name only the last one running will be saved.
     */
    export var extractors: Object;

    export interface VTSConnectOptions {
        /**
         * The name or IP address of the VTS server host. HTTP is assumed by default, unless the URL begins with HTTPS.
         */
        server: string
        /**
         * The port number.
         */
        port: number
        /**
         * The user name.
         */
        userName?: string
        /**
         * A plain text password.
         */
        password?: string
    }

    /**
     * The VTS integration API allows you to connect to a VTS server and perform various operations on it such as reading and writing from columns, managing indices, and more.
     *
     * @export
     * @class VTS
     */
    export function vtsConnect(options: VTSConnectOptions): VTSClient

    export enum VTSPlacementType {
        sameRow,
        stacked,
        unique
    }

    /**
     * The _VTSClient_ is responsible for issuing commands to the VTS server.
     * Use it to obtain other VTS related constructs such as _VTSColumn_ and _VTSRow_.
     * The client allows you to perform general operations that affect more than one column, row, or field.
     *
     * @export
     * @class VTSClient
     */
    export class VTSClient {
        /**
         * Returns a reference to a column in the VTS server with the given column name. Does not verify that the column actually exists.
         *
         * @param columnName
         */
        getColumn(columnName: string): VTSColumn

        /**
         * Returns a reference to a row in the VTS server with the given row index.
         * Does not verify that the row exists but the index must be a non-negative number.
         *
         * @param rowIndex
         */
        getRow(rowIndex: number): VTSRow

        /**
         * Creates a column on the VTS server and returns a reference to the created column.
         *
         * @param columnName
         */
        createColumn(columnName: string): VTSColumn

        /**
         * Pops the first fields from specified columns. _columnNames_ is an array of the column names that will be popped.
         * If _columnNames_ is not specified then all the columns are popped. Returns an array of the values from the popped columns.
         *
         * Returns an object where each property key corresponds to a column name and each property value corresponds to the database value.
         *
         * @param columnNames
         */
        popColumns(columnNames: Array<string>): Object

        /**
         * Retrieves the first field from the specified columns and moves the value to the bottom.
         * _columnNames_ is an array of the column names that will be rotated.
         * If _columnNames_ is not specified then all the columns are rotated.
         * _placementType_ must be one of the following:
         *
         * **`load.VTSPlacementType.stacked`** - The data is sent to an available field at the bottom of the column.
         *
         * **`load.VTSPlacementType.unique`** - If the value of the first field already exists elsewhere in the column,
         * the top field is retrieved and then discarded. Otherwise, data is sent to an available field at the bottom of the column.
         *
         * Returns an object where each property key corresponds to a column name and each property value corresponds to the database value.
         *
         * @param columnNames
         * @param placementType
         */
        rotateColumns(columnNames: Array<string>, placementType: VTSPlacementType): Object

        /**
         * Sets the data given in _values_ into the columns given by _columnNames_.
         * The number of columns must be identical to the number of values provided.
         *
         * _placementType_ must be one of the following:
         * **`load.VTSPlacementType.sameRow`** - Send all the data to the same row.
         *
         * **`load.VTSPlacementType.stacked`** - Data is sent to available fields in each column according to VTS internal logic.
         *
         * **`load.VTSPlacementType.unique`** - Data is sent to available fields in each column only if the value does not already exist in the column it would be written to.
         *
         * @param columnNames
         * @param values
         * @param placementType
         */
        setValues(columnNames: Array<string>, values: Array<string>, placementType: VTSPlacementType): Object

        /**
         * Replaces the given _newValue_ in all the columns that were specified by _columnNames_ and where the current field
         * value equals _existingValue_
         *
         * @param columnNames
         * @param newValue
         * @param existingValue
         */
        replaceExistingValue(columnNames: Array<string>, newValue: string, existingValue: string)

        /**
         * Searches for a row containing specific _values_ in specific columns.
         * If more than one row meets the condition, the data from only one random row is returned.
         *
         * @param columnNames - The names of the columns to search. The column names are separated by the _delimiter_.
         * @param values - The values of the columns to search. The values are separated by the delimiter.
         * @param delimiter - The character that separates the column names and values in the lists. If a string, rather than a single character, is passed in _delimiter_, the string as a whole is the _delimiter_.
         */
        searchRows(columnNames: Array<string>, values: Array<string>, delimiter: string): Object
    }

    /**
     * The VTSColumn is a reference to a column in the VTS server. Use this object to perform operations on the underlying column.
     *
     * @export
     * @class VTSColumn
     */
    export class VTSColumn {
        readonly client: VTSClient;

        /**
         * Clears all data in a column.
         *
         * @memberof VTSColumn
         */
        clear(): void;

        /**
         * Returns the number of fields that contain data in a column.
         *
         * @returns {number}
         * @memberof VTSColumn
         */
        size(): number

        /**
         * Creates an index on a column. If a column is not indexed, the time required to execute _addUnique()_ increases with the number of rows.
         * If the column is indexed, the time for 'send if unique' operations are constant.
         * For large databases, we recommend that you index columns you want to perform 'unique' operations.
         * A column is locked while an index is being built on it. Any function calls that change the column are queued until the index build completes.
         * If the index exists, this function has no effect.
         *
         * @memberof VTSColumn
         */
        createIndex(): void;

        /**
         * Deletes the index on a column.
         *
         * @memberof VTSColumn
         */
        dropIndex(): void;

        /**
         * Sets the last field of a column to a value. If there is no empty field in the column, a new row is created.
         * If _ifUnique_ is `true` then checks if the value does not exist in the column.
         * If the value already exists in the column, the function has no effect.
         * If a column is not indexed, the time required to execute a _addValue()_ with _ifUnique_ set to `true` increases with the number of rows.
         * If the column is indexed, the time is constant.
         * For large databases, we recommend that you index columns you want to perform this operation on via _createIndex()_.
         *
         * @param {string} value
         * @param {boolean} ifUnique
         * @memberof VTSColumn
         */
        addValue(value: string, ifUnique: boolean): void;

        /**
         * Clears the data in a field within the column defined by the rowIndex.
         *
         * @param {number} rowIndex
         * @memberof VTSColumn
         */
        clearField(rowIndex: number): void;

        /**
         * Changes the value in the field within the column defined by the rowIndex, by the amount passed in argument value.
         * If the field value cannot be converted to an integer or if there is no data in the field,
         * the field value after the call is value.
         *
         * **Note:** _value_ must be a number.
         *
         * @param {number} rowIndex
         * @param {number} value
         * @memberof VTSColumn
         */
        incrementField(rowIndex: number, value: number): void;

        /**
         * Retrieves the data in a field. If there is no data in the field, the output is `null`.
         *
         * @param {number} rowIndex
         * @returns {string}
         * @memberof VTSColumn
         */
        getFieldValue(rowIndex: number): string | null;

        /**
         * Writes the value to the field within the column defined by the rowIndex.
         * If _existingValue_ was specified, the _existingValue_ and the field value match, the field value is overwritten.
         *
         * @param {number} rowIndex
         * @param {string} value
         * @param {string} existingValue
         * @memberof VTSColumn
         */
        setFieldValue(rowIndex: number, value: string, existingValue: string): void;

        /**
         * Retrieves the value from the field in the top row of the column.
         * All fields below the first row move up one row.
         * For example, after the call, the value that was in the second row in the column is in the first row,
         * the value that was in the third row is in the second row, and so on. The last field in the column is cleared.
         *
         * @returns {string}
         * @memberof VTSColumn
         */
        pop(): string

        /**
         * Retrieves the data in the first field of the column.
         * The data is removed from the first field and moved to the bottom of the column as specified by the placementType parameter.
         * If there is no data in a cell, the output is `null`.
         *
         * @param {VTSPlacementType} placementType - placementType must be one of the following:
         `load.VTSPlacementType.stacked` - The data is sent to an available field at the bottom of the column.
         `load.VTSPlacementType.unique` - If the value of the first field already exists elsewhere in the column, the top field is retrieved and then discarded. Otherwise, data is sent to an available field at the bottom of the column.
         * @returns {string}
         * @memberof VTSColumn
         */
        rotate(placementType: VTSPlacementType): string | null;
    }

    export class VTSRow {
        /**
         * The client which contains this row.
         */
        readonly client: VTSClient;

        /**
         * Clears the values from all fields in a row. If a cell has a value, clear() sets the value to an empty string.
         * Cells with no value are not affected. Querying such cells returns null before and after the call to _clear()_.
         *
         * @memberof VTSColumn
         */
        clear(): void;

        /**
         * Retrieves the data in a row as an object which has a property that corresponds to each column name.
         * If there is no data in a field, the corresponding output is `null`.
         *
         * @returns {Object}
         * @memberof VTSRow
         */
        getValues(): Object;

        /**
         * Sets the data given in values into the columns given by columnNames. The number of columns must be identical to the number of values provided.
         * placementType must be one of the following:
         * **`load.VTSPlacementType.sameRow`** - Send all the data to the same row.
         * **`load.VTSPlacementType.stacked`** - Data is sent to available fields in each column according to VTS internal logic.
         * **`load.VTSPlacementType.unique`** - Data is sent to available fields in each column only if the value does not already exist in the column it would be written to.
         *
         * @param {Array<string>} columnNames
         * @param {Array<string>} values
         * @memberof VTSRow
         */
        setValues(columnNames: Array<string>, values: Array<VTSPlacementType>): void;

    }

    /**
     * An object that enables you to create a timer that fires after a specified delay.
     * The timer can fire once, or every time the specified delay has passed, until it is stopped.
     *
     * @class Timer
     */
    export class Timer {
        /**
         * Creates a new timer that will call the given _callback_ function after, at least, _delay_ milliseconds.
         * It is possible to make the timer call the callback only once, or consecutively, using the appropriate methods.
         *
         * @param callback the _callback_ to call each time the timer fires
         * @param delay interval time in [milliseconds]
         */
        constructor(callback: Function, delay: number);

        /**
         * stops the requested timer
         */
        stop(): Timer;

        /**
         * Starts a timer and sets it to call the callback each time the delay (in milliseconds) has passed.
         *
         * Each call to _timer.startTimeout()_ must be followed by _timer.wait()_, or there may be undefined behavior when the timer delay has elapsed.
         * For example, the iteration might end before the timer fired.
         */
        startInterval(): Timer;

        /**
         * Starts a timer that will call the _callback_ when the time (in milliseconds) has passed.
         *
         * Each call to _timer.startTimeout()_ must we followed by _timer.wait()_, or there may be undefined behavior when the timer delay has elapsed.
         * For example, the iteration might end before the timer fired.
         */
        startTimeout(): Timer;

        /**
         * Waits for the timeout or interval timer to finish before allowing the iteration to continue.
         * It **must** be accompanied by _await_, since it returns a promise.
         */
        wait(): Promise<undefined>;
    }

    /**
     * The rendezvous function creates a rendezvous point in a DevWeb script.
     * When this statement is executed, the Vuser stops running and waits for permission to continue.
     * This function can only be used in an action section, and not in an initialize or finalize sections.
     * This capability is not available when executing scripts locally using OpenText™ Performance Engineering for Developers.
     *
     * @param {string} name - The rendezvous name (name must be without spaces).
     */
    export function rendezvous(name: string): void;

    export interface FileReadResult {
        /**
         * The entire content of the read file. This property is only available when "returnContent" is set to true in the _options_.
         * If _isBinaryResponse_ was set to `true` then the content of the file is returned as a binary `Buffer`.
         */
        content: string | Buffer;
        /**
         * The extracted results of the given extractors. See the "Extractor results" section in the SDK documentation.
         */
        extractors: Object;
    }

    export interface FileReadOptions {
        /**
         * When set to `true`, will ignore the caching mechanism and read the file from disk.
         * Use this option only if the read file can change during the script run.
         */
        forceRead?: boolean
        /**
         * When `true`, the entire content of the file is returned (see extractors property for retrieving partial file data).
         */
        returnContent: boolean
        /**
         * When `true`, the read content is expected to be binary and therefore will be returned in a `Buffer`.
         */
        isBinaryContent: boolean
        /**
         * An extractor object or an array of extractor objects to apply on the response of this read operation.
         */
        extractors?: ExtractorObject | Array<ExtractorObject>
    }

    export class File {

        /**
         * Creates a file object that will perform operations on a file at the given path.
         * The engine controls the file lifecycle, therefore, you don't need to open/close the file.
         *
         * @param {string} path - Absolute path or a relative path to the script directory.
         */
        constructor(path: string);

        /**
         * Reads the text file and returns the read value based on the given _options_.
         */
        read(options: FileReadOptions): FileReadResult;

        /**
         * Appends the _content_ to the end of the file.
         * If the content is a `Buffer`, the appended content will be binary.
         */
        append(content: string | Buffer): void;

        /**
         * Writes the _content_ to the file, overwriting the existing content of the file.
         * If the content is a `Buffer`, the appended content will be binary.
         */
        write(content: string | Buffer): void;

        /**
         * Checks if the specified file exists.
         */
        isExists(): boolean;
    }

    export interface ExecutionOptions {
        /**
         * The executable file to run.
         */
        command: string

        /**
         * If set to `true` a `Promise` will be returned. The `Promise` is resolved with the _ExecutionResult_ when the process exists.
         */
        isAsync?: boolean

        /**
         * The command line arguments for the executable.
         */
        args?: Array<string>

        /**
         * If set to `true` the standard output will be returned to the vuser script (`false` by default to reduce memory footprint).
         */
        returnOutput?: boolean

        /**
         * If set to `true` the standard errors output will be returned to the vuser script (`false` by default to reduce memory footprint).
         */
        returnError?: boolean

        /**
         * Additional environment variables to define for the created process in the format "key=value".
         */
        env?: Array<string>

        /**
         * The working directory of the created process.
         */
        cwd?: string

        /**
         * The input the created process will read from the standard input.
         */
        input?: string
    }

    export interface ExecutionResult {
        /**
         * The exit code of the created process.
         */
        exitCode: number

        /**
         * The standard output of the created process. It will be available only if _returnOutput_ was set to `true`.
         */
        output: string

        /**
         * The standard error of the created process. It will be available only if _returnError_ was set to `true`.
         */
        error: string

        /**
         * The error message returned from the created process. It will be available only if the exit code is not `0`.
         */
        message: string
    }

    /**
     * Executes a shell command with the permissions of the DevWeb process.
     * Returns either an _ExecutionResult_ object for the synchronous version or a Promise that is resolved with the
     *  _ExecutionResult_ object for the asynchronous version.
     *
     * @param {ExecutionOptions} options
     * @returns {ExecutionResult | Promise<ExecutionResult>}
     */
    export function exec(options: ExecutionOptions): ExecutionResult | Promise<ExecutionResult>;

    /**
     * Executes a shell command with the permissions of the DevWeb process.
     * Returns _ExecutionResult_ object.
     *
     * @param {string} command - The executable file to run.
     * @param {Array<string>} args - The command line arguments for the executable.
     * @returns {ExecutionResult}
     */
    export function exec(command: string, args: Array<string>): ExecutionResult;
}
