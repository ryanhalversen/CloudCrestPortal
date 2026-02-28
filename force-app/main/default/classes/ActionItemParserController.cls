public with sharing class ActionItemParserController {

    @AuraEnabled
    public static String parseActionItems(String bulletPoints) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:Anthropic_API/v1/messages');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('anthropic-version', '2023-06-01');
        req.setTimeout(30000);

        String systemPrompt = 'You are a meeting action item parser for CloudCrest. '
            + 'Given bullet points from meeting notes, split them into two categories:\n'
            + '1. "us" - items CloudCrest/our team needs to handle\n'
            + '2. "client" - items the client needs to handle\n\n'
            + 'Respond ONLY with valid JSON in this exact format, no markdown:\n'
            + '{"us": ["item1", "item2"], "client": ["item1", "item2"]}\n\n'
            + 'Items mentioning "we will", "our team", "CloudCrest" go to "us". '
            + 'Items mentioning "client", "you will", "customer", "they need" go to "client". '
            + 'When truly ambiguous, default to "us".';

        Map<String, Object> body = new Map<String, Object>{
            'model' => 'claude-sonnet-4-20250514',
            'max_tokens' => 1000,
            'system' => systemPrompt,
            'messages' => new List<Object>{
                new Map<String, Object>{
                    'role' => 'user',
                    'content' => bulletPoints
                }
            }
        };

        req.setBody(JSON.serialize(body));

        Http http = new Http();
        HttpResponse res = http.send(req);

        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('API error: ' + res.getStatus() + ' ' + res.getBody());
        }

        Map<String, Object> responseMap = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<Object> content = (List<Object>) responseMap.get('content');
        Map<String, Object> firstBlock = (Map<String, Object>) content[0];
        return (String) firstBlock.get('text');
    }
}