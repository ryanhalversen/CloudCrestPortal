@isTest
private class ActionItemParserControllerTest {

    @isTest
    static void testParseActionItems_Success() {
        Test.setMock(HttpCalloutMock.class, new MockAnthropicSuccess());
        Test.startTest();
        String result = ActionItemParserController.parseActionItems('• We need to set up sandbox\n• Client to provide logo');
        Test.stopTest();

        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(result);
        System.assert(parsed.containsKey('us'), 'Should have us key');
        System.assert(parsed.containsKey('client'), 'Should have client key');
    }

    @isTest
    static void testParseActionItems_ApiError() {
        Test.setMock(HttpCalloutMock.class, new MockAnthropicError());
        Test.startTest();
        try {
            ActionItemParserController.parseActionItems('some input');
            System.assert(false, 'Should have thrown exception');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage() != null);
        }
        Test.stopTest();
    }

    // --- Mocks ---

    private class MockAnthropicSuccess implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setBody('{"content":[{"type":"text","text":"{\"us\":[\"Set up sandbox environment\"],\"client\":[\"Provide logo assets\"]}"}]}');
            return res;
        }
    }

    private class MockAnthropicError implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(500);
            res.setStatus('Internal Server Error');
            return res;
        }
    }
}