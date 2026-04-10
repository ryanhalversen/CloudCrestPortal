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

    @IsTest
    static void testGetSopStages() {
        SOP__c sop = new SOP__c(
            Name        = '1. Test SOP',
            Category__c = 'Sales',
            Status__c   = 'Active',
            Body__c     = '<p>Test body</p>',
            Summary__c  = '<p>Test summary</p>'
        );
        insert sop;

        Test.startTest();
        List<CC_LeadToCashController.SopWrapper> results =
            CC_LeadToCashController.getSopStages();
        Test.stopTest();

        System.assertEquals(1, results.size(), 'Expected one SOP');
        System.assertEquals('1. Test SOP', results[0].name);
        System.assertEquals('Sales', results[0].category);
        System.assertNotEquals(null, results[0].body);
    }
}
