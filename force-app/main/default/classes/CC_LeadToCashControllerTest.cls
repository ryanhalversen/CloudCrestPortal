@IsTest
private class CC_LeadToCashControllerTest {

    @TestSetup
    static void makeData() {
        Initiative__c init = new Initiative__c(Name = 'Test Initiative');
        insert init;

        Action_Item__c ai = new Action_Item__c(
            Name          = 'Test Action Item',
            Initiative__c = init.Id
        );
        insert ai;
    }

    @IsTest
    static void testGetInitiativesWithActionItems() {
        Test.startTest();
        List<CC_LeadToCashController.InitiativeWrapper> results =
            CC_LeadToCashController.getInitiativesWithActionItems();
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Expected one initiative');
        System.assertEquals('Test Initiative', results[0].name);
        System.assertEquals(1, results[0].actionItems.size(), 'Expected one action item');
        System.assertEquals('Test Action Item', results[0].actionItems[0].name);
    }
}
