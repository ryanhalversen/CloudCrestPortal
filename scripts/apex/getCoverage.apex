String p = '%Test%';
List<ApexClass> cls = [SELECT Name FROM ApexClass WHERE NamespacePrefix = null AND Status = 'Active' AND Name NOT LIKE :p];
for(ApexClass c : cls){
    System.debug('CLASS: ' + c.Name);
}