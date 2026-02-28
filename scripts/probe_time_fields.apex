Case c = [SELECT Id FROM Case WHERE Subject = 'Meetings' LIMIT 1];
try {
    insert new Time__c(
        Case__c           = c.Id,
        Minutes_Logged__c = 30,
        Logged_Date__c    = Date.today()
    );
    System.debug('SUCCESS');
} catch (DmlException ex) {
    System.debug('DML ERROR: ' + ex.getMessage());
    System.debug('FIELDS: ' + ex.getDmlFieldNames(0));
}
