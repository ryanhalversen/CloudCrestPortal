@isTest
public class ServiceContractControllerTest {

    @TestSetup
    static void setupData() {
        // Create Account (required for ServiceContract)
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        // Create ServiceContract with standard pricebook assigned
        ServiceContract sc = new ServiceContract(
            Name         = 'Test Contract',
            AccountId    = acc.Id,
            Pricebook2Id = Test.getStandardPricebookId(),
            StartDate    = Date.today(),
            EndDate      = Date.today().addYears(1)
        );
        insert sc;

        // Create a Product for the line item
        Product2 prod = new Product2(Name = 'Test Product', IsActive = true);
        insert prod;

        // Pricebook entry required for ContractLineItem
        Id stdPbId = Test.getStandardPricebookId();
        PricebookEntry pbe = new PricebookEntry(
            Pricebook2Id = stdPbId,
            Product2Id   = prod.Id,
            UnitPrice    = 100.00,
            IsActive     = true
        );
        insert pbe;

        // Create ContractLineItem
        ContractLineItem cli = new ContractLineItem(
            ServiceContractId = sc.Id,
            PricebookEntryId  = pbe.Id,
            Quantity          = 2,
            UnitPrice         = 100.00
        );
        insert cli;
    }

    @isTest
    static void testControllerWithLineItems() {
        ServiceContract sc = [SELECT Id FROM ServiceContract WHERE Name = 'Test Contract' LIMIT 1];

        Test.startTest();
        ApexPages.StandardController stdCtrl = new ApexPages.StandardController(sc);
        ServiceContractController ctrl = new ServiceContractController(stdCtrl);
        Test.stopTest();

        System.assertNotEquals(null, ctrl.serviceContract,   'Service contract should not be null');
        System.assertNotEquals(null, ctrl.contractLineItems, 'Line items should not be null');
        System.assertEquals(1, ctrl.contractLineItems.size(), 'Should have 1 line item');
        System.assertEquals(2, ctrl.contractLineItems[0].Quantity, 'Quantity should be 2');
    }

    @isTest
    static void testControllerNoLineItems() {
        // Create a contract with no line items
        Account acc = [SELECT Id FROM Account WHERE Name = 'Test Account' LIMIT 1];
        ServiceContract sc = new ServiceContract(
            Name      = 'Empty Contract',
            AccountId = acc.Id,
            StartDate = Date.today(),
            EndDate   = Date.today().addYears(1)
        );
        insert sc;

        Test.startTest();
        ApexPages.StandardController stdCtrl = new ApexPages.StandardController(sc);
        ServiceContractController ctrl = new ServiceContractController(stdCtrl);
        Test.stopTest();

        System.assertNotEquals(null, ctrl.contractLineItems, 'Line items list should not be null');
        System.assertEquals(0, ctrl.contractLineItems.size(), 'Should have no line items');
    }
}